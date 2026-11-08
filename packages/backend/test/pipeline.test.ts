import { postAnchorAbi, verifyInclusion, type LeafValue, type TrustedKey } from '@phi/core';
import { verifyPublishedPost } from '@phi/verifier';
import type { Hono } from 'hono';
import { decodeAbiParameters, getAbiItem, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startChain, type TestChain } from '../../verifier/test/harness.ts';
import { createApp } from '../src/app.ts';
import { chainContext, type ChainContext } from '../src/chains.ts';
import type { ChainConfig } from '../src/config.ts';
import type { Sql } from '../src/db.ts';
import type { Deps } from '../src/deps.ts';
import { disclosureMessage } from '../src/api/disclosure.ts';
import { tick } from '../src/runner.ts';
import { MemoryStorage, type Storage } from '../src/storage.ts';
import { anchorChain } from '../src/workers/anchor.ts';
import { batchChain, uploadManifests } from '../src/workers/batcher.ts';
import { MAX_STORAGE_ATTEMPTS, storeReceivedPosts } from '../src/workers/storage.ts';
import { freshDatabase } from './db-helpers.ts';
import { otherUser, submission, testConfig, testDeps, testKeyStore, user } from './fixtures.ts';

const BASE = 84532;
const ARBITRUM = 421614;
const TMAX = 10;

let base: TestChain;
let arbitrum: TestChain;
let sql: Sql;
let storage: MemoryStorage;
let deps: Deps;
let app: Hono;
let contexts: ChainContext[];
let clock = Math.floor(Date.now() / 1000);

const request = (path: string, init?: RequestInit) => app.request(path, { ...init, headers: { 'content-type': 'application/json', 'x-test-ip': '10.0.0.1', ...init?.headers } });
const submit = async (chainIds: number[], signer = user, username = 'ana') => {
  const res = await request('/posts', { method: 'POST', body: JSON.stringify(await submission(clock, { chainIds, signer, username })) });
  expect(res.status).toBe(202);
  return (await res.json()) as { postHash: Hex };
};
const ctx = (chainId: number) => contexts.find((c) => c.config.chainId === chainId)!;
const batchOf = async (postHash: Hex, chainId: number) =>
  (await sql`SELECT b.* FROM batches b JOIN post_chains pc ON pc.batch_id = b.id WHERE pc.post_hash = ${Buffer.from(postHash.slice(2), 'hex')} AND pc.chain_id = ${chainId}`)[0]!;

beforeAll(async () => {
  [base, arbitrum] = await Promise.all([startChain(BASE), startChain(ARBITRUM)]);
  ({ sql } = await freshDatabase());
  storage = new MemoryStorage();
  const relayer = base.accounts.relayer; // anvil derives the same accounts on both nodes
  const chains: ChainConfig[] = [
    { chainId: BASE, name: 'Base Sepolia', rpcUrl: base.url, tmaxSeconds: TMAX, nmax: 500 },
    { chainId: ARBITRUM, name: 'Arbitrum Sepolia', rpcUrl: arbitrum.url, tmaxSeconds: TMAX, nmax: 500 },
  ];
  const keyStore = testKeyStore();
  deps = testDeps(sql, testConfig(chains), () => clock, { ...keyStore, evmAccount: (ref) => (ref === 'relayer' ? relayer : keyStore.evmAccount(ref)) });
  app = createApp(deps, (c) => c.req.header('x-test-ip') ?? 'unknown');
  contexts = chains.map((c) => chainContext(c, relayer));
});

afterAll(async () => {
  base?.stop();
  arbitrum?.stop();
  await sql?.end();
});

describe('pipeline end to end', () => {
  it('takes posts from submission to settled on two chains, in one batch per chain, and the verifier accepts them', async () => {
    const posts = [await submit([BASE, ARBITRUM]), await submit([BASE, ARBITRUM]), await submit([BASE, ARBITRUM], otherUser, 'bob')];

    await tick(deps, storage, contexts); // stores, queues; Tmax not reached yet
    expect((await sql`SELECT count(*)::int AS n FROM batches`)[0]!.n).toBe(0);
    clock += TMAX + 1;
    await tick(deps, storage, contexts); // batch + manifest + submit (automined)
    await tick(deps, storage, contexts); // receipt: ANCHORED
    await Promise.all([base.mine(), base.mine(), arbitrum.mine(), arbitrum.mine()]);
    await tick(deps, storage, contexts); // safe head past the anchor block: SETTLED

    const batches = await sql`SELECT chain_id, post_count, state FROM batches ORDER BY chain_id`;
    expect(batches.map((b) => [b.chain_id, b.post_count, b.state])).toEqual([[BASE, 3, 'SETTLED'], [ARBITRUM, 3, 'SETTLED']]);

    const status = await (await request(`/status/${posts[0]!.postHash}`)).json();
    expect(status.chains.map((c: { stage: string }) => c.stage)).toEqual(['settled', 'settled']);

    const trustedKeys: TrustedKey[] = [
      ...[BASE, ARBITRUM].map((chainId): TrustedKey => ({ role: 'relayer', chainId, address: base.accounts.relayer.address, validFrom: '2026-01-01T00:00:00Z', revokedAt: null, note: 'test' })),
      { role: 'receipt', chainId: null, address: testKeyStore().evmAccount('receipt').address, validFrom: '2026-01-01T00:00:00Z', revokedAt: null, note: 'test' },
    ];
    for (const { postHash } of posts) {
      const bundle = await (await request(`/proof/${postHash}`)).json();
      const report = await verifyPublishedPost(postHash, { hints: bundle }, { sources: { arweave: storage, chains: { [BASE]: base.source, [ARBITRUM]: arbitrum.source } }, trustedKeys, now: () => clock });
      expect(report.ok).toBe(true);
      expect(report.chains.map((c) => [c.chainId, c.verdict, c.late])).toEqual([[BASE, 'anchored', false], [ARBITRUM, 'anchored', false]]);
    }

    // Authorship: the author asks for the signature and completes the private bundle; the verifier proves it.
    const { postHash } = posts[0]!;
    const message = disclosureMessage(postHash, clock);
    const disclosed = await (await request('/disclosure', { method: 'POST', body: JSON.stringify({ postHash, issuedAt: clock, signature: await user.signMessage({ message }) }) })).json();
    const privateBundle = { ...(await (await request(`/proof/${postHash}`)).json()), ...disclosed };
    const report = await verifyPublishedPost(postHash, { hints: privateBundle }, { sources: { arweave: storage, chains: { [BASE]: base.source, [ARBITRUM]: arbitrum.source } }, trustedKeys, now: () => clock });
    expect(report.authorship).toEqual({ proven: true, signer: user.address, errors: [] });

    // No indexable user dimension on Arweave: no username tag on any item (ADR-014).
    expect([...storage.items.values()].flatMap((i) => i.tags.map((t) => t.name))).not.toContain('Username');

    // Public detail for the post page: full timeline, the shared batch and a Merkle proof that checks out.
    const detail = await (await request(`/posts/${postHash}`)).json();
    expect(detail).toMatchObject({ postHash, username: 'ana', state: 'STORED' });
    expect(detail.storedAt).toBeGreaterThanOrEqual(detail.acceptedAt);
    for (const chain of detail.chains) {
      expect(chain).toMatchObject({ stage: 'settled', batch: { postCount: 3, replacements: 0 } });
      expect(chain.batch.batchedAt).toBeGreaterThanOrEqual(detail.storedAt);
      expect(chain.batch.settledAt).toBeGreaterThanOrEqual(chain.batch.batchedAt);
      expect(chain.proof.siblings).toHaveLength(2); // 3 leaves: depth 2
      const leaf = decodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], chain.proof.leafData);
      expect(verifyInclusion(chain.batch.root, leaf as unknown as LeafValue, chain.proof.siblings)).toBe(true);
    }
    const serialized = JSON.stringify(detail).toLowerCase();
    expect(serialized).not.toContain(user.address.slice(2).toLowerCase());
    expect(serialized).not.toContain(disclosed.signature.slice(2).toLowerCase());

    // Recent posts, newest first, with per-chain stages.
    const recent = await (await request('/posts?limit=2')).json();
    expect(recent).toHaveLength(2);
    expect(recent[0].acceptedAt).toBeGreaterThanOrEqual(recent[1].acceptedAt);
    expect(recent[0].chains.map((c: { stage: string }) => c.stage)).toEqual(['settled', 'settled']);
  });

  it('flushes before Tmax on a demo flush request', async () => {
    const { postHash } = await submit([BASE]);
    await storeReceivedPosts(deps, storage);
    expect(await batchChain(deps, ctx(BASE).config)).toBeNull();
    deps.flushRequests.add(BASE);
    expect(await batchChain(deps, ctx(BASE).config)).not.toBeNull();
    expect(deps.flushRequests.has(BASE)).toBe(false);
    expect((await batchOf(postHash, BASE)).state).toBe('CREATED');
    await uploadManifests(deps, storage, BASE);
    await anchorChain(deps, ctx(BASE));
    await anchorChain(deps, ctx(BASE));
  });
});

describe('anchor worker failure handling (ADR-008)', () => {
  const prepare = async () => {
    const { postHash } = await submit([BASE]);
    await storeReceivedPosts(deps, storage);
    deps.flushRequests.add(BASE);
    await batchChain(deps, ctx(BASE).config);
    await uploadManifests(deps, storage, BASE);
    return batchOf(postHash, BASE);
  };

  it('replaces a stuck transaction with the same nonce and higher fees; only one version lands', async () => {
    const batch = await prepare();
    await base.setAutomine(false);
    try {
      await anchorChain(deps, ctx(BASE)); // submitted, stays in the mempool
      const submitted = (await sql`SELECT * FROM batches WHERE id = ${batch.id}`)[0]!;
      expect([submitted.state, submitted.tx_history.length]).toEqual(['SUBMITTED', 1]);

      await anchorChain(deps, ctx(BASE)); // too early to replace
      expect((await sql`SELECT tx_history FROM batches WHERE id = ${batch.id}`)[0]!.tx_history).toHaveLength(1);

      clock += 61;
      await anchorChain(deps, ctx(BASE)); // replacement
      const replaced = (await sql`SELECT * FROM batches WHERE id = ${batch.id}`)[0]!;
      expect(replaced.tx_history).toHaveLength(2);
      expect(BigInt(replaced.max_fee_per_gas)).toBeGreaterThan(BigInt(submitted.max_fee_per_gas));
      expect(replaced.nonce).toBe(submitted.nonce);

      await base.mine();
      await anchorChain(deps, ctx(BASE));
      const anchored = (await sql`SELECT * FROM batches WHERE id = ${batch.id}`)[0]!;
      expect(anchored.state).toBe('ANCHORED');
      const logs = await base.publicClient.getLogs({ address: ctx(BASE).contract, event: getAbiItem({ abi: postAnchorAbi, name: 'BatchAnchored' }), args: { root: `0x${batch.root.toString('hex')}` as Hex }, fromBlock: 0n });
      expect(logs).toHaveLength(1);
    } finally {
      await base.setAutomine(true);
    }
  });

  it('adopts a root already anchored on-chain instead of sending it again (crash after send)', async () => {
    const batch = await prepare();
    const root = `0x${batch.root.toString('hex')}` as Hex;
    const hash = await ctx(BASE).walletClient.writeContract({ address: ctx(BASE).contract, abi: postAnchorAbi, functionName: 'anchor', args: [root, `0x${'00'.repeat(31)}01`, 1], account: base.accounts.relayer, chain: null });
    await base.publicClient.waitForTransactionReceipt({ hash });
    const nonceBefore = await base.publicClient.getTransactionCount({ address: base.accounts.relayer.address });

    await anchorChain(deps, ctx(BASE));
    const adopted = (await sql`SELECT * FROM batches WHERE id = ${batch.id}`)[0]!;
    expect(adopted.state).toBe('ANCHORED');
    expect(adopted.tx_history).toEqual([]);
    expect(adopted.block_number).not.toBeNull();
    expect(await base.publicClient.getTransactionCount({ address: base.accounts.relayer.address })).toBe(nonceBefore);
  });

  it('marks a batch whose anchor would revert as FAILED instead of retrying blindly', async () => {
    const batch = await prepare();
    await sql`UPDATE batches SET root = ${Buffer.alloc(32)} WHERE id = ${batch.id}`;
    await anchorChain(deps, ctx(BASE));
    const failed = (await sql`SELECT state, last_error FROM batches WHERE id = ${batch.id}`)[0]!;
    expect(failed.state).toBe('FAILED');
    expect(failed.last_error).toContain('ZeroRoot');
  });
});

describe('storage worker', () => {
  it('retries failed uploads and gives up after the maximum number of attempts', async () => {
    const { postHash } = await submit([BASE]);
    const broken: Storage = { upload: async () => Promise.reject(new Error('turbo unavailable')) };
    for (let i = 0; i < MAX_STORAGE_ATTEMPTS; i++) await storeReceivedPosts(deps, broken);
    const row = (await sql`SELECT state, attempts, last_error FROM posts WHERE post_hash = ${Buffer.from(postHash.slice(2), 'hex')}`)[0]!;
    expect([row.state, row.attempts, row.last_error]).toEqual(['FAILED', MAX_STORAGE_ATTEMPTS, 'turbo unavailable']);
    const chains = await sql`SELECT state FROM post_chains WHERE post_hash = ${Buffer.from(postHash.slice(2), 'hex')}`;
    expect(chains.map((c) => c.state)).toEqual(['WAITING']); // never queued: anchors never point to missing data
  });
});
