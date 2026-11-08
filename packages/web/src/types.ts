export type { Hex } from 'viem';
export type { ProofBundle, SignedReceipt } from '@phi/core';

export type ChainStatus = { chainId: number; stage: 'accepted' | 'published' | 'settled' | 'failed'; state: string; anchorBy: number; txHash: string | null; blockNumber: number | null; anchoredAt: number | null };
export type PostStatus = { postHash: string; state: string; acceptedAt: number; postArweaveId: string | null; chains: ChainStatus[] };
