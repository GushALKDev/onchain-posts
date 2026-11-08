import { CHAIN_IDS } from '@phi/core';
import { z } from 'zod';

export type ChainConfig = { chainId: number; name: string; rpcUrl: string; tmaxSeconds: number; nmax: number };

export type Config = {
  port: number;
  databaseUrl: string;
  dbHmacSecret: string;
  keystorePath: string;
  keyRefs: { relayer: string; receipt: string; arweave: string; signatureEncryption: string };
  storageMode: 'turbo' | 'memory';
  chains: ChainConfig[];
  demo: { enabled: boolean; tmaxSeconds: number; flushToken: string | null };
  limits: { postsPerSignerPerMinute: number; requestsPerIpPerMinute: number; postsPerDay: number };
};

/** Receipt deadline budget (design parameters, ADR-006): anchorBy = acceptedAt + storage + Tmax + submission + inclusion. */
export const RECEIPT_BUDGET = { storageSeconds: 60, submissionSeconds: 30, inclusionSeconds: 60 } as const;

/** Intent and request checks (design parameters, ADR-012). */
export const INTENT_RULES = { maxCreatedAtSkewSeconds: 300, maxDeadlineAheadSeconds: 3600 } as const;

const CHAIN_DEFAULTS = [
  { chainId: CHAIN_IDS.ethereumSepolia, name: 'Ethereum Sepolia', env: 'ETHEREUM_SEPOLIA', tmax: 300 },
  { chainId: CHAIN_IDS.baseSepolia, name: 'Base Sepolia', env: 'BASE_SEPOLIA', tmax: 30 },
  { chainId: CHAIN_IDS.arbitrumSepolia, name: 'Arbitrum Sepolia', env: 'ARBITRUM_SEPOLIA', tmax: 30 },
] as const;
const DEFAULT_NMAX = 500;

const intFrom = (fallback: number) => z.coerce.number().int().positive().default(fallback);

/** Reads the environment (.env.example lists every variable). A chain is enabled when its RPC URL is set. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const base = z
    .object({
      PORT: intFrom(8080),
      DATABASE_URL: z.string().min(1),
      DB_HMAC_SECRET: z.string().min(32, 'DB_HMAC_SECRET must be at least 32 characters'),
      SIGNER_MODE: z.enum(['simulator', 'kms']).default('simulator'),
      KMS_SIMULATOR_KEYSTORE_PATH: z.string().default('.keystore.json'),
      RELAYER_SIGNER_KEY_REF: z.string().default('relayer'),
      RECEIPT_SIGNER_KEY_REF: z.string().default('receipt'),
      ARWEAVE_SIGNER_KEY_REF: z.string().default('arweave'),
      SIGNATURE_ENCRYPTION_KEY_REF: z.string().default('signature-encryption'),
      STORAGE_MODE: z.enum(['turbo', 'memory']).default('turbo'),
      DEMO_MODE: z.enum(['true', 'false']).default('false'),
      DEMO_TMAX_SECONDS: intFrom(5),
      DEMO_FLUSH_TOKEN: z.string().optional(),
    })
    .parse(env);
  if (base.SIGNER_MODE === 'kms') throw new Error('SIGNER_MODE=kms is not implemented in the PoC; use the simulator (ADR-016)');
  const demo = base.DEMO_MODE === 'true';
  if (demo && (!base.DEMO_FLUSH_TOKEN || base.DEMO_FLUSH_TOKEN.length < 16)) throw new Error('DEMO_MODE requires DEMO_FLUSH_TOKEN of at least 16 characters (ADR-018)');

  const chains = CHAIN_DEFAULTS.flatMap((c): ChainConfig[] => {
    const rpcUrl = env[`${c.env}_RPC_URL`];
    if (!rpcUrl) return [];
    const tmax = intFrom(c.tmax).parse(env[`TMAX_SECONDS_${c.env}`]);
    return [{ chainId: c.chainId, name: c.name, rpcUrl, tmaxSeconds: demo ? base.DEMO_TMAX_SECONDS : tmax, nmax: intFrom(DEFAULT_NMAX).parse(env[`NMAX_${c.env}`]) }];
  });
  if (chains.length === 0) throw new Error('no chain enabled: set at least one *_RPC_URL');

  return {
    port: base.PORT,
    databaseUrl: base.DATABASE_URL,
    dbHmacSecret: base.DB_HMAC_SECRET,
    keystorePath: base.KMS_SIMULATOR_KEYSTORE_PATH,
    keyRefs: { relayer: base.RELAYER_SIGNER_KEY_REF, receipt: base.RECEIPT_SIGNER_KEY_REF, arweave: base.ARWEAVE_SIGNER_KEY_REF, signatureEncryption: base.SIGNATURE_ENCRYPTION_KEY_REF },
    storageMode: base.STORAGE_MODE,
    chains,
    demo: { enabled: demo, tmaxSeconds: base.DEMO_TMAX_SECONDS, flushToken: base.DEMO_FLUSH_TOKEN ?? null },
    limits: { postsPerSignerPerMinute: 10, requestsPerIpPerMinute: 120, postsPerDay: 10_000 },
  };
}
