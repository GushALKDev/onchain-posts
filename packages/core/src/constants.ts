import type { Address } from 'viem';

/** Chain IDs of the three supported testnets (ADR-007). */
export const CHAIN_IDS = {
  ethereumSepolia: 11155111,
  baseSepolia: 84532,
  arbitrumSepolia: 421614,
} as const;

export const SUPPORTED_CHAIN_IDS: readonly number[] = Object.values(CHAIN_IDS);

/** Predicted CREATE2 address of PostAnchor, identical on the three chains (ADR-009). Also the EIP-712 verifyingContract. */
export const POST_ANCHOR_ADDRESS: Address = '0x36b5D5F0D176b96013678FC69C34038897fAF382';

export const CONTENT_TYPE_POST = 'post';

export const POST_SCHEMA = 'onchain-posts.post/1';
export const MANIFEST_SCHEMA = 'onchain-posts.manifest/1';
export const PROOF_SCHEMA = 'onchain-posts.proof/1';
export const TRUSTED_KEYS_SCHEMA = 'onchain-posts.trusted-keys/1';

/** Limits, all design parameters (ADR-003, ADR-012). */
export const LIMITS = {
  imageMaxBytes: 95 * 1024,
  imageMaxSide: 1080,
  // 1,000 code points bound the UTF-8 size to 4,000 bytes, so no separate byte limit is needed.
  captionMaxCodePoints: 1000,
  usernameMinLength: 3,
  usernameMaxLength: 30,
  maxChainsPerPost: 3,
} as const;
