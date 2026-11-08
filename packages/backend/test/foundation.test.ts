import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { keccak256, toBytes } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/db.ts';
import { simulatorKeyStore } from '../src/keys.ts';
import { redact } from '../src/log.ts';
import { decryptSignature, encryptSignature, hmacAddress } from '../src/privacy.ts';
import { freshDatabase } from './db-helpers.ts';

const refs = { relayer: 'relayer', receipt: 'receipt', arweave: 'arweave', signatureEncryption: 'signature-encryption' };
const address = '0x1111111111111111111111111111111111111111';
const signature = `0x${'ab'.repeat(65)}` as const;
const postHash = keccak256(toBytes('post'));
const dir = mkdtempSync(path.join(tmpdir(), 'phi-backend-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('privacy boundary', () => {
  it('HMACs addresses deterministically, case-insensitively and only with the right secret', () => {
    const secret = 'x'.repeat(32);
    expect(hmacAddress(secret, address)).toEqual(hmacAddress(secret, address.toUpperCase().replace('0X', '0x') as `0x${string}`));
    expect(hmacAddress(secret, address)).not.toEqual(hmacAddress('y'.repeat(32), address));
    expect(hmacAddress(secret, address).toString('hex')).not.toContain(address.slice(2));
  });

  it('encrypts signatures so they decrypt only with the key and for the same post', () => {
    const key = new Uint8Array(32).fill(7);
    const blob = encryptSignature(key, postHash, signature);
    expect(blob.toString('hex')).not.toContain(signature.slice(2));
    expect(decryptSignature(key, postHash, blob)).toBe(signature);
    expect(() => decryptSignature(new Uint8Array(32).fill(8), postHash, blob)).toThrow();
    expect(() => decryptSignature(key, keccak256(toBytes('other post')), blob)).toThrow();
  });

  it('redacts addresses and signatures from log text', () => {
    expect(redact(`signer ${address} sig ${signature}`)).toBe('signer 0x[address] sig 0x[signature]');
  });
});

describe('KMS simulator', () => {
  it('generates every key once, stores them with owner-only permissions and reloads the same keys', () => {
    const file = path.join(dir, 'keystore.json');
    const first = simulatorKeyStore(file, refs);
    expect(first.created).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const second = simulatorKeyStore(file, refs);
    expect(second.created).toBe(false);
    expect(second.keyStore.evmAccount('relayer').address).toBe(first.keyStore.evmAccount('relayer').address);
    expect(second.keyStore.evmAccount('relayer').address).not.toBe(second.keyStore.evmAccount('receipt').address);
    expect(second.keyStore.arweaveJwk('arweave').kty).toBe('RSA');
    expect(second.keyStore.symmetricKey('signature-encryption')).toHaveLength(32);
    expect(() => second.keyStore.evmAccount('arweave')).toThrow(/not a secp256k1 key/);
    expect(readFileSync(file, 'utf8')).toContain('Never commit it');
  });
});

describe('config', () => {
  const env = { DATABASE_URL: 'postgres://x', DB_HMAC_SECRET: 's'.repeat(32), BASE_SEPOLIA_RPC_URL: 'http://base', ETHEREUM_SEPOLIA_RPC_URL: 'http://eth' };

  it('enables the chains whose RPC URL is set, with the ADR-006 defaults', () => {
    const config = loadConfig(env);
    expect(config.chains.map((c) => [c.chainId, c.tmaxSeconds, c.nmax])).toEqual([
      [11155111, 300, 500],
      [84532, 30, 500],
    ]);
  });

  it('uses the demo Tmax in demo mode and requires a flush token', () => {
    expect(() => loadConfig({ ...env, DEMO_MODE: 'true' })).toThrow(/DEMO_FLUSH_TOKEN/);
    const demo = loadConfig({ ...env, DEMO_MODE: 'true', DEMO_FLUSH_TOKEN: 't'.repeat(16) });
    expect(demo.chains.every((c) => c.tmaxSeconds === 5)).toBe(true);
  });

  it('treats empty variables as unset', () => {
    const config = loadConfig({ ...env, TMAX_SECONDS_BASE_SEPOLIA: '', ARBITRUM_SEPOLIA_RPC_URL: '', DEMO_FLUSH_TOKEN: '' });
    expect(config.chains.map((c) => [c.chainId, c.tmaxSeconds])).toEqual([[11155111, 300], [84532, 30]]);
  });

  it('rejects a short HMAC secret and the unimplemented KMS mode', () => {
    expect(() => loadConfig({ ...env, DB_HMAC_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() => loadConfig({ ...env, SIGNER_MODE: 'kms' })).toThrow(/not implemented/);
  });
});

describe('database', () => {
  it('applies the migrations once and is idempotent', async () => {
    const { sql } = await freshDatabase();
    expect(await migrate(sql)).toEqual([]);
    const tables = await sql<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
    expect(tables.map((t) => t.table_name)).toEqual(['batches', 'disclosure_log', 'post_chains', 'posts', 'schema_migrations', 'usernames']);
    await sql.end();
  });
});
