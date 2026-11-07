import { keccak256, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CONTENT_TYPE_POST, imageHash, type Post, type PublishIntent } from '../src/index.ts';

/** Test-only keys derived from labels, so they are obviously not real keys. */
export const userAccount = privateKeyToAccount(keccak256(toBytes('phi-test-user')));
export const receiptAccount = privateKeyToAccount(keccak256(toBytes('phi-test-receipt-key')));

export function samplePost(i: number, withImage = true): Post {
  return {
    username: 'ana',
    contentType: CONTENT_TYPE_POST,
    caption: `caption ${i}: café`.normalize('NFC'),
    imageHash: imageHash(withImage ? toBytes(`image bytes ${i}`) : null),
    createdAt: 1_762_480_000n + BigInt(i),
  };
}

export function sampleIntent(post: Post, i: number): PublishIntent {
  return { post, chainIds: [84532n, 421614n], nonce: keccak256(toBytes(`nonce ${i}`)), deadline: 1_762_490_000n };
}

/** Deterministic Arweave-style ID (43 base64url characters) derived from a label. */
export function sampleArweaveId(label: string): string {
  const bytes = toBytes(keccak256(toBytes(label)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type ChunkSpec = { fourCC: string; payload: Uint8Array };

/** Builds a RIFF/WEBP container from raw chunks (payloads are not decoded, only framed). */
export function buildWebp(chunks: ChunkSpec[]): Uint8Array {
  const body = chunks.flatMap(({ fourCC, payload }) => {
    const header = new Uint8Array(8);
    header.set(toBytes(fourCC), 0);
    new DataView(header.buffer).setUint32(4, payload.length, true);
    return payload.length % 2 ? [header, payload, new Uint8Array(1)] : [header, payload];
  });
  const length = 12 + body.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  out.set(toBytes('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, length - 8, true);
  out.set(toBytes('WEBP'), 8);
  let cursor = 12;
  for (const part of body) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** VP8X payload (10 bytes): flags, 3 reserved bytes, canvas width - 1 and height - 1 as 24-bit little endian. */
export function vp8x(flags: number, width: number, height: number): Uint8Array {
  const p = new Uint8Array(10);
  p[0] = flags;
  const w = width - 1;
  const h = height - 1;
  p.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);
  return p;
}

/** Minimal VP8 (lossy) frame header with the given dimensions, enough for the parser. */
export function vp8(width: number, height: number): Uint8Array {
  return Uint8Array.from([0x9d, 0x01, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 0]);
}

export const hexOf = (bytes: Uint8Array): Hex => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
