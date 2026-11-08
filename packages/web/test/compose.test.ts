import { ProofBundleSchema, imageHash, recoverIntentSigner } from '@phi/core';
import { keccak256, toBytes, zeroHash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { privateBundle } from '../src/bundle.ts';
import { INTENT_TTL_SECONDS, buildSubmission, toBase64 } from '../src/compose.ts';
import { developmentSigner, type PostSigner } from '../src/signer.ts';
import type { LocalPost } from '../src/store.ts';

const account = privateKeyToAccount(keccak256(toBytes('phi-web-test')));
const signer: PostSigner = { kind: 'development', label: 'test', address: account.address, signTypedData: (d) => account.signTypedData(d), signMessage: (message) => account.signMessage({ message }) };
const NOW = 1_800_000_000;

describe('buildSubmission', () => {
  it('normalises before signing and produces a signature that recovers to the signer', async () => {
    const image = toBytes('final webp bytes');
    const built = await buildSubmission({ username: '  Ana_B ', caption: 'café', image, chainIds: [84532, 421614] }, signer, NOW);
    expect(built.body.intent.post).toEqual({ username: 'ana_b', contentType: 'post', caption: 'café', imageHash: imageHash(image), createdAt: NOW });
    expect(built.body.intent.deadline).toBe(NOW + INTENT_TTL_SECONDS);
    expect(built.body.image).toBe(toBase64(image));
    expect(await recoverIntentSigner(built.intent, built.signature)).toBe(account.address);
  });

  it('uses the zero image hash and no image for a text-only post, and a fresh random nonce each time', async () => {
    const a = await buildSubmission({ username: 'ana', caption: 'text only', image: null, chainIds: [84532] }, signer, NOW);
    const b = await buildSubmission({ username: 'ana', caption: 'text only', image: null, chainIds: [84532] }, signer, NOW);
    expect(a.body.intent.post.imageHash).toBe(zeroHash);
    expect(a.body.image).toBeNull();
    expect(a.body.intent.nonce).not.toBe(b.body.intent.nonce);
    expect(a.postHash).toBe(b.postHash); // same content, same postHash: the backend rejects the duplicate
  });

  it('rejects what the server would reject, before asking for a signature', async () => {
    await expect(buildSubmission({ username: 'a-b', caption: '', image: null, chainIds: [84532] }, signer, NOW)).rejects.toThrow(/\[a-z0-9_\]/);
    await expect(buildSubmission({ username: 'ana', caption: 'x'.repeat(1001), image: null, chainIds: [84532] }, signer, NOW)).rejects.toThrow(/code points/);
    await expect(buildSubmission({ username: 'ana', caption: '', image: null, chainIds: [] }, signer, NOW)).rejects.toThrow(/at least one chain/);
  });

  it('encodes large images to base64 without overflowing the call stack', () => {
    const big = new Uint8Array(96 * 1024).map((_, i) => i % 256);
    expect(Buffer.from(toBase64(big), 'base64')).toEqual(Buffer.from(big));
  });
});

describe('development signer and private bundle', () => {
  it('keeps the same key across sessions in the given storage', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(developmentSigner(storage).address).toBe(developmentSigner(storage).address);
  });

  it('adds the local signature and intent fields to the public hints, giving a schema-valid private bundle', () => {
    const h = (s: string) => keccak256(toBytes(s));
    const publicBundle = {
      schema: 'phi.proof/1' as const,
      postHash: h('post'),
      postArweaveId: 'A'.repeat(43),
      imageArweaveId: null,
      anchors: [],
      pending: [{ chainId: 84532, anchorBy: NOW + 100 }],
      receipt: { postHash: h('post'), sigCommit: h('sig'), acceptedAt: NOW, deadlines: [{ chainId: 84532, anchorBy: NOW + 100 }], signature: `0x${'ab'.repeat(65)}` },
    };
    const local = { signature: `0x${'cd'.repeat(65)}`, intent: { chainIds: [84532], nonce: h('n'), deadline: NOW + 600 } } as LocalPost;
    const bundle = privateBundle(publicBundle, local);
    expect(ProofBundleSchema.safeParse(bundle).success).toBe(true);
    expect(bundle).toMatchObject({ signature: local.signature, intent: local.intent });
  });
});
