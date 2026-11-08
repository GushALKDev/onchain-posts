import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Account, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

/** Arweave RSA key in JWK form, as the Turbo SDK's ArweaveSigner expects. */
export type ArweaveJwk = { kty: string; n: string; e: string; d?: string; p?: string; q?: string; dp?: string; dq?: string; qi?: string };

/**
 * Every platform key goes through this interface (ADR-016): a KMS in production, the simulator below in the PoC.
 * Swapping one for the other changes configuration, not the callers.
 */
export interface KeyStore {
  /** secp256k1 account for relayer transactions and receipt signatures. */
  evmAccount(ref: string): Account;
  /** RSA key that signs Arweave data items (the ANS-104 owner is the platform, never the user, ADR-002). */
  arweaveJwk(ref: string): ArweaveJwk;
  /** 32-byte key for AES-256-GCM encryption of user signatures at rest (ADR-013). */
  symmetricKey(ref: string): Uint8Array;
}

type StoredKey = { type: 'secp256k1'; privateKey: Hex } | { type: 'rsa'; jwk: ArweaveJwk } | { type: 'aes-256'; key: string };
type KeystoreFile = { warning: string; keys: Record<string, StoredKey> };

const typeError = (ref: string, expected: string) => new Error(`key "${ref}" is missing or is not a ${expected} key`);

export function keyStoreFromKeys(keys: Record<string, StoredKey>): KeyStore {
  return {
    evmAccount(ref) {
      const key = keys[ref];
      if (key?.type !== 'secp256k1') throw typeError(ref, 'secp256k1');
      return privateKeyToAccount(key.privateKey);
    },
    arweaveJwk(ref) {
      const key = keys[ref];
      if (key?.type !== 'rsa') throw typeError(ref, 'rsa');
      return key.jwk;
    },
    symmetricKey(ref) {
      const key = keys[ref];
      if (key?.type !== 'aes-256') throw typeError(ref, 'aes-256');
      const bytes = Buffer.from(key.key, 'base64');
      if (bytes.length !== 32) throw new Error(`key "${ref}" must be 32 bytes`);
      return new Uint8Array(bytes);
    },
  };
}

export function generateKeys(refs: { relayer: string; receipt: string; arweave: string; signatureEncryption: string }): Record<string, StoredKey> {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 4096, publicExponent: 65537 });
  return {
    [refs.relayer]: { type: 'secp256k1', privateKey: generatePrivateKey() },
    [refs.receipt]: { type: 'secp256k1', privateKey: generatePrivateKey() },
    [refs.arweave]: { type: 'rsa', jwk: privateKey.export({ format: 'jwk' }) as ArweaveJwk },
    [refs.signatureEncryption]: { type: 'aes-256', key: randomBytes(32).toString('base64') },
  };
}

/**
 * KMS simulator: keys in a local JSON file outside the database, generated on first start. Not for production:
 * a real KMS never exposes private keys to the process.
 */
export function simulatorKeyStore(path: string, refs: Parameters<typeof generateKeys>[0], options = { create: true }): { keyStore: KeyStore; created: boolean } {
  if (!existsSync(path) && !options.create) throw new Error(`no keystore at ${path}`);
  if (existsSync(path)) {
    const file = JSON.parse(readFileSync(path, 'utf8')) as KeystoreFile;
    return { keyStore: keyStoreFromKeys(file.keys), created: false };
  }
  const file: KeystoreFile = { warning: 'KMS simulator keystore for the PoC. Never commit it, never use it in production.', keys: generateKeys(refs) };
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  return { keyStore: keyStoreFromKeys(file.keys), created: true };
}
