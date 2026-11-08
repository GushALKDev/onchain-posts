import { POST_ANCHOR_ADDRESS } from '@phi/core';
import { createPublicClient, createWalletClient, defineChain, http, type Account, type Address, type PublicClient, type WalletClient } from 'viem';
import type { ChainConfig } from './config.ts';

/** Clients the anchor worker and the tracker need for one chain. */
export type ChainContext = { config: ChainConfig; publicClient: PublicClient; walletClient: WalletClient; relayer: Account; contract: Address };

export function chainContext(config: ChainConfig, relayer: Account, contract: Address = POST_ANCHOR_ADDRESS): ChainContext {
  const chain = defineChain({ id: config.chainId, name: config.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
  return {
    config,
    publicClient: createPublicClient({ chain, transport: http(config.rpcUrl) }) as PublicClient,
    walletClient: createWalletClient({ account: relayer, chain, transport: http(config.rpcUrl) }),
    relayer,
    contract,
  };
}
