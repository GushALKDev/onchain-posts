// Prints the platform's public addresses (relayer and receipt) and a config/trusted-keys.json entry template for each.
// Never prints private keys. Usage: node dist/print-keys.js (in Docker: docker compose exec backend node dist/print-keys.js)
import { CHAIN_IDS, TRUSTED_KEYS_SCHEMA } from '@onchain-posts/core';
import { simulatorKeyStore } from './keys.ts';

const env = process.env;
const refs = {
  relayer: env.RELAYER_SIGNER_KEY_REF ?? 'relayer',
  receipt: env.RECEIPT_SIGNER_KEY_REF ?? 'receipt',
  arweave: env.ARWEAVE_SIGNER_KEY_REF ?? 'arweave',
  signatureEncryption: env.SIGNATURE_ENCRYPTION_KEY_REF ?? 'signature-encryption',
};
const { keyStore } = simulatorKeyStore(env.KMS_SIMULATOR_KEYSTORE_PATH ?? '.keystore.json', refs, { create: false });
const relayer = keyStore.evmAccount(refs.relayer).address;
const receipt = keyStore.evmAccount(refs.receipt).address;
const validFrom = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

console.log(
  JSON.stringify(
    {
      schema: TRUSTED_KEYS_SCHEMA,
      keys: [
        ...Object.values(CHAIN_IDS).map((chainId) => ({ role: 'relayer', chainId, address: relayer, validFrom, revokedAt: null, note: 'relayer key' })),
        { role: 'receipt', chainId: null, address: receipt, validFrom, revokedAt: null, note: 'receipt-signing key' },
      ],
    },
    null,
    2,
  ),
);
