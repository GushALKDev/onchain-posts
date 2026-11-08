export type { Hex } from 'viem';
export type { ProofBundle, SignedReceipt } from '@onchain-posts/core';
import type { SignedReceipt } from '@onchain-posts/core';

export type Stage = 'accepted' | 'published' | 'settled' | 'failed';

export type PostImage = { arweaveId: string | null; hash: string; mime: string; bytes: number; width: number; height: number };

export type PostSummary = {
  postHash: string;
  username: string;
  caption: string;
  createdAt: number;
  acceptedAt: number;
  state: string;
  postArweaveId: string | null;
  image: PostImage | null;
  chains: { chainId: number; stage: Stage }[];
};

export type ChainDetail = {
  chainId: number;
  stage: Stage;
  state: string;
  anchorBy: number;
  batch: {
    id: number;
    root: string | null;
    postCount: number | null;
    manifestArweaveId: string | null;
    sender: string | null;
    nonce: number | null;
    txHash: string | null;
    replacements: number;
    batchedAt: number | null;
    submittedAt: number | null;
    blockNumber: number | null;
    anchoredAt: number | null;
    settledAt: number | null;
  } | null;
  proof: { leafData: string; siblings: string[] } | null;
};

export type PostDetail = Omit<PostSummary, 'chains'> & { storedAt: number | null; sigCommit: string; receipt: SignedReceipt; chains: ChainDetail[] };
