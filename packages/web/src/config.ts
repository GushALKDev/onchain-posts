import { CHAIN_IDS } from '@phi/core';
import { DEFAULT_GATEWAYS } from '@phi/verifier';

export type ChainInfo = { chainId: number; name: string; short: string; layer: 'L1' | 'L2'; rpcUrl: string; explorer: string; color: string };

const env = import.meta.env;

const KNOWN: Record<number, Omit<ChainInfo, 'rpcUrl'> & { defaultRpc: string; rpcOverride?: string }> = {
  [CHAIN_IDS.ethereumSepolia]: { chainId: CHAIN_IDS.ethereumSepolia, name: 'Ethereum Sepolia', short: 'Ethereum', layer: 'L1', explorer: 'https://sepolia.etherscan.io', color: '#6366f1', defaultRpc: 'https://ethereum-sepolia-rpc.publicnode.com', rpcOverride: env.VITE_RPC_11155111 },
  [CHAIN_IDS.baseSepolia]: { chainId: CHAIN_IDS.baseSepolia, name: 'Base Sepolia', short: 'Base', layer: 'L2', explorer: 'https://sepolia.basescan.org', color: '#2563eb', defaultRpc: 'https://sepolia.base.org', rpcOverride: env.VITE_RPC_84532 },
  [CHAIN_IDS.arbitrumSepolia]: { chainId: CHAIN_IDS.arbitrumSepolia, name: 'Arbitrum Sepolia', short: 'Arbitrum', layer: 'L2', explorer: 'https://sepolia.arbiscan.io', color: '#0ea5e9', defaultRpc: 'https://sepolia-rollup.arbitrum.io/rpc', rpcOverride: env.VITE_RPC_421614 },
};

export const API_URL = (env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
/** Public Arweave gateways, tried in order (content is always checked by hash). */
export const GATEWAYS: string[] = (env.VITE_ARWEAVE_GATEWAYS ?? DEFAULT_GATEWAYS.join(',')).split(',').map((g) => g.trim().replace(/\/+$/, '')).filter(Boolean);
/** GraphQL of an ar.io gateway, to show who owns each Arweave item and its tags. */
export const ARWEAVE_GRAPHQL = env.VITE_ARWEAVE_GRAPHQL ?? 'https://turbo-gateway.com/graphql';
/** Turbo's public status endpoint for an upload (new, pending in a bundle, finalized on Arweave). */
export const TURBO_STATUS = 'https://upload.ardrive.io/v1/tx';
export const DEMO_MODE = env.VITE_DEMO_MODE === 'true';

export const CHAINS: ChainInfo[] = (env.VITE_CHAINS ?? Object.keys(KNOWN).join(','))
  .split(',')
  .map((id) => KNOWN[Number(id.trim())])
  .filter((c): c is NonNullable<typeof c> => Boolean(c))
  .map(({ defaultRpc, rpcOverride, ...c }) => ({ ...c, rpcUrl: rpcOverride ?? defaultRpc }));

export const chainInfo = (chainId: number): ChainInfo | undefined => {
  const known = KNOWN[chainId];
  if (!known) return undefined;
  const { defaultRpc, rpcOverride, ...c } = known;
  return { ...c, rpcUrl: rpcOverride ?? defaultRpc };
};
export const chainName = (chainId: number) => KNOWN[chainId]?.name ?? `chain ${chainId}`;
