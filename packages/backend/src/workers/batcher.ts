import { buildBatch, type BatchEntry } from '@phi/core';
import { bytesToHex, hexToBytes } from 'viem';
import type { ChainConfig } from '../config.ts';
import type { Deps } from '../deps.ts';
import { log, redact } from '../log.ts';
import { APP_NAME, type Storage } from '../storage.ts';

/**
 * One queue per chain; flush when N >= Nmax or the oldest queued post has waited Tmax, or on a demo flush request
 * (ADR-006). Returns the new batch id, or null when nothing was flushed.
 */
export async function batchChain(deps: Deps, chain: ChainConfig): Promise<number | null> {
  const [queue] = await deps.sql<{ queued: number; oldest: string | null }[]>`
    SELECT count(*)::int AS queued, min(queued_at) AS oldest FROM post_chains WHERE chain_id = ${chain.chainId} AND state = 'QUEUED'`;
  if (!queue || queue.queued === 0) return null;
  const flushRequested = deps.flushRequests.has(chain.chainId);
  const waited = deps.now() - Number(queue.oldest);
  if (queue.queued < chain.nmax && waited < chain.tmaxSeconds && !flushRequested) return null;
  deps.flushRequests.delete(chain.chainId);

  return deps.sql.begin(async (tx) => {
    const rows = await tx<{ post_hash: Buffer; post_arweave_id: string; sig_commit: Buffer }[]>`
      SELECT pc.post_hash, p.post_arweave_id, p.sig_commit
      FROM post_chains pc JOIN posts p ON p.post_hash = pc.post_hash
      WHERE pc.chain_id = ${chain.chainId} AND pc.state = 'QUEUED'
      ORDER BY pc.queued_at, pc.post_hash LIMIT ${chain.nmax}
      FOR UPDATE OF pc SKIP LOCKED`;
    if (rows.length === 0) return null;
    const entries: BatchEntry[] = rows.map((r) => ({ postHash: bytesToHex(r.post_hash), postArweaveId: r.post_arweave_id, sigCommit: bytesToHex(r.sig_commit) }));
    const { manifest } = buildBatch(chain.chainId, entries);
    const [batch] = await tx<{ id: string }[]>`
      INSERT INTO batches (chain_id, root, manifest, post_count, state)
      VALUES (${chain.chainId}, ${Buffer.from(hexToBytes(manifest.root))}, ${tx.json(manifest)}, ${rows.length}, 'CREATED') RETURNING id`;
    const id = Number(batch!.id);
    await tx`UPDATE post_chains SET state = 'BATCHED', batch_id = ${id} WHERE chain_id = ${chain.chainId} AND post_hash IN ${tx(rows.map((r) => r.post_hash))}`;
    log.info('batch created', { chainId: chain.chainId, batchId: id, posts: rows.length, flushRequested });
    return id;
  });
}

/** Uploads the manifest of each new batch; a batch becomes READY for anchoring only once its manifest is stored. */
export async function uploadManifests(deps: Deps, storage: Storage, chainId: number): Promise<number> {
  let uploaded = 0;
  for (;;) {
    const done = await deps.sql.begin(async (tx) => {
      const [batch] = await tx<{ id: string; manifest: { root: string } }[]>`
        SELECT id, manifest FROM batches WHERE chain_id = ${chainId} AND state = 'CREATED' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!batch) return false;
      try {
        const manifestId = await storage.upload(new TextEncoder().encode(JSON.stringify(batch.manifest)), [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: APP_NAME },
          { name: 'Type', value: 'batch-manifest' },
          { name: 'Chain-Id', value: String(chainId) },
          { name: 'Merkle-Root', value: batch.manifest.root },
        ]);
        await tx`UPDATE batches SET manifest_arweave_id = ${manifestId}, state = 'READY', updated_at = now() WHERE id = ${batch.id}`;
        uploaded++;
        return true;
      } catch (error) {
        await tx`UPDATE batches SET attempts = attempts + 1, last_error = ${redact((error as Error).message)} WHERE id = ${batch.id}`;
        log.warn('manifest upload failed', { chainId, batchId: Number(batch.id) });
        return false;
      }
    });
    if (!done) return uploaded;
  }
}
