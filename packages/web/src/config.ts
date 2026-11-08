import { CHAIN_IDS } from '@phi/core';

export type ChainInfo = { chainId: number; name: string; rpcUrl: string; explorerTx: string };

const env = import.meta.env;

const KNOWN: Record<number, Omit<ChainInfo, 'rpcUrl'> & { defaultRpc: string; rpcOverride?: string }> = {
  [CHAIN_IDS.ethereumSepolia]: { chainId: CHAIN_IDS.ethereumSepolia, name: 'Ethereum Sepolia', explorerTx: 'https://sepolia.etherscan.io/tx/', defaultRpc: 'https://ethereum-sepolia-rpc.publicnode.com', rpcOverride: env.VITE_RPC_11155111 },
  [CHAIN_IDS.baseSepolia]: { chainId: CHAIN_IDS.baseSepolia, name: 'Base Sepolia', explorerTx: 'https://sepolia.basescan.org/tx/', defaultRpc: 'https://sepolia.base.org', rpcOverride: env.VITE_RPC_84532 },
  [CHAIN_IDS.arbitrumSepolia]: { chainId: CHAIN_IDS.arbitrumSepolia, name: 'Arbitrum Sepolia', explorerTx: 'https://sepolia.arbiscan.io/tx/', defaultRpc: 'https://sepolia-rollup.arbitrum.io/rpc', rpcOverride: env.VITE_RPC_421614 },
};

export const API_URL = (env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
export const GATEWAY_URL = env.VITE_ARWEAVE_GATEWAY ?? 'https://arweave.net';
export const DEMO_MODE = env.VITE_DEMO_MODE === 'true';

export const CHAINS: ChainInfo[] = (env.VITE_CHAINS ?? Object.keys(KNOWN).join(','))
  .split(',')
  .map((id) => KNOWN[Number(id.trim())])
  .filter((c): c is NonNullable<typeof c> => Boolean(c))
  .map(({ defaultRpc, rpcOverride, ...c }) => ({ ...c, rpcUrl: rpcOverride ?? defaultRpc }));

export const chainName = (chainId: number) => KNOWN[chainId]?.name ?? `chain ${chainId}`;
