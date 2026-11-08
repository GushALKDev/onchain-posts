import type { ChainContext } from './chains.ts';
import type { Deps } from './deps.ts';
import { log, redact } from './log.ts';
import type { Storage } from './storage.ts';
import { anchorChain } from './workers/anchor.ts';
import { batchChain, uploadManifests } from './workers/batcher.ts';
import { storeReceivedPosts } from './workers/storage.ts';
import { settleChain } from './workers/tracker.ts';

/** One pass of the whole pipeline: storage, then per chain batcher, manifest upload, anchor worker and tracker. */
export async function tick(deps: Deps, storage: Storage, chains: ChainContext[]): Promise<void> {
  await guarded('storage', () => storeReceivedPosts(deps, storage));
  for (const ctx of chains) {
    const chainId = ctx.config.chainId;
    await guarded(`batcher ${chainId}`, () => batchChain(deps, ctx.config));
    await guarded(`manifests ${chainId}`, () => uploadManifests(deps, storage, chainId));
    await guarded(`anchor ${chainId}`, () => anchorChain(deps, ctx));
    await guarded(`tracker ${chainId}`, () => settleChain(deps, ctx));
  }
}

async function guarded(stage: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    // One failing chain or RPC must not stop the others; the next tick retries.
    log.error('worker stage failed', { stage, error: redact((error as Error).message) });
  }
}

/** Runs the pipeline every `intervalMs` until stopped. Ticks never overlap. */
export function startWorkers(deps: Deps, storage: Storage, chains: ChainContext[], intervalMs = 1000): { stop: () => Promise<void> } {
  let running = true;
  const loop = (async () => {
    while (running) {
      await tick(deps, storage, chains);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
    },
  };
}
