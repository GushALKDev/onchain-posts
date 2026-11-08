import { ProofBundleSchema, recoverReceiptSigner, receiptFromJson } from '@onchain-posts/core';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { anchorByFor } from '../src/receipts.ts';
import { disclosureMessage } from '../src/api/disclosure.ts';
import type { ChainConfig } from '../src/config.ts';
import type { Sql } from '../src/db.ts';
import type { Deps } from '../src/deps.ts';
import { MemoryStorage } from '../src/storage.ts';
import { freshDatabase } from './db-helpers.ts';
import { otherUser, submission, testConfig, testDeps, testKeyStore, user, webp } from './fixtures.ts';

const BASE: ChainConfig = { chainId: 84532, name: 'Base Sepolia', rpcUrl: 'http://unused', tmaxSeconds: 30, nmax: 500 };
const ETH: ChainConfig = { chainId: 11155111, name: 'Ethereum Sepolia', rpcUrl: 'http://unused', tmaxSeconds: 300, nmax: 500 };
const NOW = 1_800_000_000;

let sql: Sql;
let deps: Deps;
let app: Hono;

const post = (body: unknown, ip = '10.0.0.1') => app.request('/posts', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-test-ip': ip } });
const get = (path: string) => app.request(path, { headers: { 'x-test-ip': '10.0.0.1' } });

beforeAll(async () => {
  ({ sql } = await freshDatabase());
  deps = testDeps(sql, testConfig([ETH, BASE]), () => NOW);
  app = createApp(deps, (c) => c.req.header('x-test-ip') ?? 'unknown');
});
afterAll(() => sql.end());

describe('POST /posts', () => {
  it('accepts a valid post and returns a receipt with one anchorBy per chain', async () => {
    const body = await submission(NOW, { chainIds: [BASE.chainId, ETH.chainId], username: 'ana' });
    const res = await post(body);
    expect(res.status).toBe(202);
    const { postHash, receipt } = await res.json();
    expect(receipt.deadlines).toEqual([
      { chainId: BASE.chainId, anchorBy: anchorByFor(NOW, BASE) },
      { chainId: ETH.chainId, anchorBy: anchorByFor(NOW, ETH) },
    ]);
    expect(await recoverReceiptSigner(receiptFromJson(receipt), receipt.signature)).toBe(testKeyStore().evmAccount('receipt').address);

    const chains = await sql`SELECT chain_id, state FROM post_chains WHERE post_hash = ${Buffer.from(postHash.slice(2), 'hex')} ORDER BY chain_id`;
    expect(chains.map((r) => [r.chain_id, r.state])).toEqual([[BASE.chainId, 'WAITING'], [ETH.chainId, 'WAITING']]);
  });

  it('stores no address and no signature in clear anywhere in the database', async () => {
    const body = await submission(NOW, { chainIds: [BASE.chainId], username: 'ana' });
    expect((await post(body)).status).toBe(202);
    const dump = JSON.stringify(await sql`SELECT row_to_json(t)::text AS row FROM (SELECT * FROM posts) t UNION ALL SELECT row_to_json(u)::text FROM usernames u`).toLowerCase();
    expect(dump).not.toContain(user.address.slice(2).toLowerCase());
    expect(dump).not.toContain(body.signature.slice(2).toLowerCase());
  });

  const rejections: [string, () => Promise<unknown>, number, string][] = [
    ['a malformed body', async () => ({ hello: 'world' }), 400, 'invalid-body'],
    ['a content type other than post', () => submission(NOW, { chainIds: [BASE.chainId], contentType: 'story' }), 400, 'content-type'],
    ['an unsupported chain', () => submission(NOW, { chainIds: [1] }), 400, 'chains'],
    ['repeated chains', () => submission(NOW, { chainIds: [BASE.chainId, BASE.chainId] }), 400, 'chains'],
    ['an expired deadline', () => submission(NOW, { chainIds: [BASE.chainId], deadline: NOW - 1 }), 400, 'deadline'],
    ['a deadline too far ahead', () => submission(NOW, { chainIds: [BASE.chainId], deadline: NOW + 7200 }), 400, 'deadline'],
    ['a createdAt far from server time', () => submission(NOW, { chainIds: [BASE.chainId], createdAt: NOW - 3600 }), 400, 'created-at'],
    ['a username that is not normalised', () => submission(NOW, { chainIds: [BASE.chainId], username: 'Ana' }), 400, 'username'],
    ['a caption that is not NFC', () => submission(NOW, { chainIds: [BASE.chainId], caption: 'café' }), 400, 'caption'],
    ['an image with an EXIF chunk', () => submission(NOW, { chainIds: [BASE.chainId], image: webp({ exif: true }) }), 400, 'image-metadata'],
    ['an image larger than 1080 px', () => submission(NOW, { chainIds: [BASE.chainId], image: webp({ width: 1600 }) }), 400, 'image-dimensions'],
    ['an image that does not match imageHash', () => submission(NOW, { chainIds: [BASE.chainId], imageHashOverride: `0x${'11'.repeat(32)}` }), 400, 'image-hash'],
    ['an image that is not WebP', () => submission(NOW, { chainIds: [BASE.chainId], image: new TextEncoder().encode('GIF89a not a webp') }), 400, 'image-format'],
  ];
  for (const [name, build, status, code] of rejections) {
    it(`rejects ${name}`, async () => {
      const res = await post(await build());
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(code);
    });
  }

  it('rejects an image over 95 KiB', async () => {
    const big = webp();
    const padded = new Uint8Array(96 * 1024);
    padded.set(big);
    const res = await post({ ...(await submission(NOW, { chainIds: [BASE.chainId], image: big })), image: Buffer.from(padded).toString('base64') });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('image-size');
  });

  it('rejects a username claimed by another account, a reused nonce and a resubmitted post', async () => {
    expect((await post(await submission(NOW, { chainIds: [BASE.chainId], username: 'bob', signer: otherUser }))).status).toBe(202);
    const stolen = await post(await submission(NOW, { chainIds: [BASE.chainId], username: 'bob', signer: user }));
    expect([stolen.status, (await stolen.json()).error]).toEqual([403, 'username-owner']);

    const first = await submission(NOW, { chainIds: [BASE.chainId], username: 'ana' });
    expect((await post(first)).status).toBe(202);
    const reusedNonce = await post(await submission(NOW, { chainIds: [BASE.chainId], username: 'ana', nonce: first.intent.nonce }));
    expect([reusedNonce.status, (await reusedNonce.json()).error]).toEqual([409, 'nonce-reused']);

    const sameContent = await submission(NOW, { chainIds: [BASE.chainId], username: 'ana', caption: first.intent.post.caption, image: null });
    expect((await post(sameContent)).status).toBe(202);
    const again = await post({ ...sameContent, ...(await submission(NOW, { chainIds: [BASE.chainId], username: 'ana', caption: first.intent.post.caption, image: null })) });
    expect([again.status, (await again.json()).error]).toEqual([409, 'duplicate-post']);
  });

  it('rate-limits posts per account', async () => {
    const strict = testDeps(sql, testConfig([BASE], { limits: { postsPerSignerPerMinute: 2, requestsPerIpPerMinute: 10_000, postsPerDay: 10_000 } }), () => NOW);
    const limitedApp = createApp(strict, () => 'ip');
    const send = async () => (await limitedApp.request('/posts', { method: 'POST', body: JSON.stringify(await submission(NOW, { chainIds: [BASE.chainId], username: 'ana' })), headers: { 'content-type': 'application/json' } })).status;
    expect([await send(), await send(), await send()]).toEqual([202, 202, 429]);
  });
});

describe('GET /proof and GET /status', () => {
  it('reports a post that is not stored yet, and 404 for an unknown one', async () => {
    const { postHash } = await (await post(await submission(NOW, { chainIds: [BASE.chainId], username: 'ana' }))).json();
    expect((await get(`/proof/${postHash}`)).status).toBe(202);
    const status = await (await get(`/status/${postHash}`)).json();
    expect(status).toMatchObject({ state: 'RECEIVED', chains: [{ chainId: BASE.chainId, stage: 'accepted', state: 'WAITING' }] });
    expect((await get(`/proof/0x${'00'.repeat(32)}`)).status).toBe(404);
    expect((await get('/proof/not-a-hash')).status).toBe(400);
  });

  it('serves a schema-valid partial bundle once stored, with every chain pending', async () => {
    const { postHash } = await (await post(await submission(NOW, { chainIds: [BASE.chainId, ETH.chainId], username: 'ana' }))).json();
    await sql`UPDATE posts SET state = 'STORED', post_arweave_id = ${'A'.repeat(43)}, image_arweave_id = ${'B'.repeat(43)} WHERE post_hash = ${Buffer.from(postHash.slice(2), 'hex')}`;
    const bundle = await (await get(`/proof/${postHash}`)).json();
    expect(ProofBundleSchema.safeParse(bundle).success).toBe(true);
    expect(bundle.anchors).toEqual([]);
    expect(bundle.pending.map((p: { chainId: number }) => p.chainId)).toEqual([BASE.chainId, ETH.chainId]);
    expect(bundle.signature).toBeUndefined();
  });
});

describe('POST /disclosure', () => {
  it('returns the signature only to the author, and logs it', async () => {
    const body = await submission(NOW, { chainIds: [BASE.chainId], username: 'ana' });
    const { postHash } = await (await post(body)).json();
    const ask = async (signer: typeof user, issuedAt = NOW) =>
      app.request('/disclosure', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-ip': '10.0.0.1' }, body: JSON.stringify({ postHash, issuedAt, signature: await signer.signMessage({ message: disclosureMessage(postHash, issuedAt) }) }) });

    const ok = await ask(user);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ signature: body.signature, intent: { chainIds: [BASE.chainId], nonce: body.intent.nonce, deadline: body.intent.deadline } });
    expect((await ask(otherUser)).status).toBe(403);
    expect((await ask(user, NOW - 3600)).status).toBe(400);
    const rows = await sql`SELECT count(*)::int AS count FROM disclosure_log WHERE post_hash = ${Buffer.from(postHash.slice(2), 'hex')}`;
    expect(rows[0]?.count).toBe(1);
  });
});

describe('POST /demo/flush', () => {
  it('does not exist outside demo mode', async () => {
    expect((await app.request('/demo/flush', { method: 'POST', headers: { 'x-test-ip': '1' } })).status).toBe(404);
  });

  it('requires the token and allows one flush per chain per minute', async () => {
    const demoDeps = testDeps(sql, testConfig([BASE], { demo: { enabled: true, tmaxSeconds: 5, flushToken: 'a-long-demo-flush-token' } }), () => NOW);
    const demoApp = createApp(demoDeps, () => 'ip');
    const flush = (token: string) => demoApp.request('/demo/flush', { method: 'POST', headers: { 'x-demo-flush-token': token } });
    expect((await flush('wrong-token-of-any-length')).status).toBe(401);
    expect((await flush('a-long-demo-flush-token')).status).toBe(202);
    expect(demoDeps.flushRequests.has(BASE.chainId)).toBe(true);
    expect((await flush('a-long-demo-flush-token')).status).toBe(429);
  });
});

describe('browser access', () => {
  it('answers CORS preflight only for the configured web origin', async () => {
    const corsApp = createApp(testDeps(sql, testConfig([BASE], { webOrigins: ['http://localhost:5173'] }), () => NOW), () => 'ip');
    const preflight = (origin: string) => corsApp.request('/posts', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
    expect((await preflight('http://localhost:5173')).headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves in-memory uploads through the dev gateway only when one is given', async () => {
    const storage = new MemoryStorage();
    const id = await storage.upload(new TextEncoder().encode('hello'), []);
    const withGateway = createApp(deps, () => 'ip', { devGateway: storage });
    expect(await (await withGateway.request(`/dev-gateway/${id}`)).text()).toBe('hello');
    expect((await withGateway.request('/dev-gateway/unknown')).status).toBe(404);
    expect((await app.request(`/dev-gateway/${id}`, { headers: { 'x-test-ip': '1' } })).status).toBe(404);
  });
});
