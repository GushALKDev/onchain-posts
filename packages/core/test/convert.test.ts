import { keccak256, toBytes, zeroHash } from 'viem';
import { describe, expect, it } from 'vitest';
import { postFromJson, postHash, receiptFromJson, type PostJson } from '../src/index.ts';
import { samplePost } from './helpers.ts';

describe('JSON to EIP-712 conversion', () => {
  it('postFromJson rebuilds the signed Post, so postHash can be recomputed from Arweave content', () => {
    const post = samplePost(5);
    const json: PostJson = {
      schema: 'onchain-posts.post/1',
      type: 'post',
      username: post.username,
      caption: post.caption,
      createdAt: Number(post.createdAt),
      image: { arweaveId: 'A'.repeat(43), hash: post.imageHash, mime: 'image/webp', bytes: 100, width: 10, height: 10 },
      postHash: postHash(post),
    };
    expect(postHash(postFromJson(json))).toBe(json.postHash);
    expect(postFromJson({ ...json, image: null }).imageHash).toBe(zeroHash);
  });

  it('receiptFromJson converts numbers to bigints', () => {
    const r = receiptFromJson({ postHash: keccak256(toBytes('p')), sigCommit: keccak256(toBytes('s')), acceptedAt: 10, deadlines: [{ chainId: 84532, anchorBy: 70 }], signature: '0x' });
    expect(r.acceptedAt).toBe(10n);
    expect(r.deadlines).toEqual([{ chainId: 84532n, anchorBy: 70n }]);
  });
});
