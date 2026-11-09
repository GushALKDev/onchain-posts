import { CONTENT_TYPE_POST, POSTS_DOMAIN, POST_TYPES, imageHash } from '@onchain-posts/core';
import { keccak256, toBytes, zeroHash, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { ChainConfig, Config } from '../src/config.ts';
import type { Sql } from '../src/db.ts';
import type { Deps } from '../src/deps.ts';
import { generateKeys, keyStoreFromKeys, type KeyStore } from '../src/keys.ts';
import { RateLimiter } from '../src/rate-limit.ts';

export const refs = { relayer: 'relayer', receipt: 'receipt', arweave: 'arweave', signatureEncryption: 'signature-encryption' };
export const user = privateKeyToAccount(keccak256(toBytes('phi-test-user')));
export const otherUser = privateKeyToAccount(keccak256(toBytes('phi-other-user')));

let keyStoreCache: KeyStore | undefined;
/** Generated once per test file (the 4096-bit RSA key takes about a second). */
export function testKeyStore(overrides: Record<string, ReturnType<typeof generateKeys>[string]> = {}): KeyStore {
  keyStoreCache ??= keyStoreFromKeys(generateKeys(refs));
  if (Object.keys(overrides).length === 0) return keyStoreCache;
  const base = keyStoreCache;
  const extra = keyStoreFromKeys(overrides);
  return {
    evmAccount: (ref) => (ref in overrides ? extra.evmAccount(ref) : base.evmAccount(ref)),
    arweaveJwk: (ref) => base.arweaveJwk(ref),
    symmetricKey: (ref) => base.symmetricKey(ref),
  };
}

export function testConfig(chains: ChainConfig[], overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    databaseUrl: 'unused',
    dbHmacSecret: 'test-hmac-secret-that-is-long-enough',
    keystorePath: 'unused',
    keyRefs: refs,
    storageMode: 'memory',
    webOrigins: [],
    trustedProxy: false,
    chains,
    demo: { enabled: false, tmaxSeconds: 5, flushToken: null },
    limits: { postsPerSignerPerMinute: 1000, requestsPerIpPerMinute: 10_000, postsPerDay: 10_000 },
    ...overrides,
  };
}

export function testDeps(sql: Sql, config: Config, now: () => number, keyStore = testKeyStore()): Deps {
  return { sql, config, keyStore, now, limiter: new RateLimiter(now), flushRequests: new Set() };
}

let counter = 0;

/** Minimal still WebP: one VP8 frame header with the given size, optionally followed by an EXIF chunk. */
export function webp(options: { width?: number; height?: number; exif?: boolean } = {}): Uint8Array {
  const w = options.width ?? 1080;
  const h = options.height ?? 1080;
  const frame = [0x9d, 0x01, 0x00, 0x9d, 0x01, 0x2a, w & 0xff, w >> 8, h & 0xff, h >> 8, counter & 0xff, (counter++ >> 8) & 0xff];
  const chunks = [...toBytes('VP8 '), 12, 0, 0, 0, ...frame];
  if (options.exif) chunks.push(...toBytes('EXIF'), 4, 0, 0, 0, ...toBytes('GPS!'));
  const size = 4 + chunks.length;
  return Uint8Array.from([...toBytes('RIFF'), size & 0xff, (size >> 8) & 0xff, 0, 0, ...toBytes('WEBP'), ...chunks]);
}

export type Submission = { intent: { post: { username: string; contentType: string; caption: string; imageHash: Hex; createdAt: number }; chainIds: number[]; nonce: Hex; deadline: number }; signature: Hex; image: string | null };

/** Builds and signs a POST /posts body the way the web app will. Fields can be overridden to test rejections. */
export async function submission(now: number, options: {
  chainIds: number[];
  signer?: PrivateKeyAccount;
  username?: string;
  caption?: string;
  image?: Uint8Array | null;
  imageHashOverride?: Hex;
  createdAt?: number;
  deadline?: number;
  nonce?: Hex;
  contentType?: string;
}): Promise<Submission> {
  const image = options.image === undefined ? webp() : options.image;
  const post = {
    username: options.username ?? 'ana',
    contentType: options.contentType ?? CONTENT_TYPE_POST,
    caption: options.caption ?? `hello ${counter++}`,
    imageHash: options.imageHashOverride ?? (image ? imageHash(image) : zeroHash),
    createdAt: options.createdAt ?? now,
  };
  const intent = { post, chainIds: options.chainIds, nonce: options.nonce ?? keccak256(toBytes(`nonce ${counter++} ${Math.random()}`)), deadline: options.deadline ?? now + 600 };
  const signature = await (options.signer ?? user).signTypedData({
    domain: POSTS_DOMAIN,
    types: POST_TYPES,
    primaryType: 'PublishIntent',
    message: { post: { ...post, createdAt: BigInt(post.createdAt) }, chainIds: intent.chainIds.map(BigInt), nonce: intent.nonce, deadline: BigInt(intent.deadline) },
  });
  return { intent, signature, image: image ? Buffer.from(image).toString('base64') : null };
}
