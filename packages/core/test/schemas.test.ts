import { readFileSync } from 'node:fs';
import { keccak256, toBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { ManifestSchema, PostJsonSchema, ProofBundleSchema, TrustedKeysFileSchema, buildBatch } from '../src/index.ts';
import { sampleArweaveId } from './helpers.ts';

const h = (s: string) => keccak256(toBytes(s));

const postJson = {
  schema: 'phi.post/1',
  type: 'post',
  username: 'ana',
  caption: 'hello',
  createdAt: 1762480000,
  image: { arweaveId: sampleArweaveId('img'), hash: h('img'), mime: 'image/webp', bytes: 81234, width: 1080, height: 1080 },
  postHash: h('post'),
};

describe('schemas', () => {
  it('the repository trust root config/trusted-keys.json is valid', () => {
    const file = JSON.parse(readFileSync(new URL('../../../config/trusted-keys.json', import.meta.url), 'utf8'));
    expect(TrustedKeysFileSchema.safeParse(file).success).toBe(true);
  });

  it('rejects a relayer key without chainId and a receipt key with one', () => {
    const base = { address: `0x${'11'.repeat(20)}`, validFrom: '2026-11-07T00:00:00Z', revokedAt: null, note: '' };
    const file = (key: object) => ({ schema: 'phi.trusted-keys/1', description: '', keys: [key] });
    expect(TrustedKeysFileSchema.safeParse(file({ ...base, role: 'relayer', chainId: null })).success).toBe(false);
    expect(TrustedKeysFileSchema.safeParse(file({ ...base, role: 'receipt', chainId: 84532 })).success).toBe(false);
  });

  it('accepts a post JSON with and without image, and rejects extra fields or oversized images', () => {
    expect(PostJsonSchema.safeParse(postJson).success).toBe(true);
    expect(PostJsonSchema.safeParse({ ...postJson, image: null }).success).toBe(true);
    expect(PostJsonSchema.safeParse({ ...postJson, author: '0xabc' }).success).toBe(false);
    expect(PostJsonSchema.safeParse({ ...postJson, image: { ...postJson.image, bytes: 95 * 1024 + 1 } }).success).toBe(false);
  });

  it('accepts a manifest produced by buildBatch', () => {
    const { manifest } = buildBatch(84532, [{ postHash: h('p'), postArweaveId: sampleArweaveId('p'), sigCommit: h('s') }]);
    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('accepts a public proof bundle and rejects a receipt with more than three deadlines', () => {
    const receipt = { postHash: h('post'), sigCommit: h('sig'), acceptedAt: 1762480000, deadlines: [{ chainId: 84532, anchorBy: 1762480120 }], signature: `0x${'ab'.repeat(65)}` };
    const bundle = {
      schema: 'phi.proof/1',
      postHash: h('post'),
      postArweaveId: sampleArweaveId('post'),
      imageArweaveId: null,
      anchors: [{ chainId: 84532, sender: `0x${'22'.repeat(20)}`, root: h('root'), manifestId: sampleArweaveId('m'), txHash: h('tx'), leafData: `0x${'cd'.repeat(96)}`, proof: [h('sibling')] }],
      pending: [],
      receipt,
    };
    expect(ProofBundleSchema.safeParse(bundle).success).toBe(true);
    const tooMany = { ...receipt, deadlines: [1, 2, 3, 4].map((i) => ({ chainId: i, anchorBy: 1 })) };
    expect(ProofBundleSchema.safeParse({ ...bundle, receipt: tooMany }).success).toBe(false);
  });
});
