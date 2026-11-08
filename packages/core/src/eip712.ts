import { hashStruct, hashTypedData, keccak256, recoverTypedDataAddress, zeroHash, type Address, type Hex } from 'viem';
import { POST_ANCHOR_ADDRESS } from './constants.ts';

/** Intent domain: no chainId, because the same signature covers up to three chains (ADR-012). */
export const POSTS_DOMAIN = { name: 'Onchain Posts', version: '1', verifyingContract: POST_ANCHOR_ADDRESS } as const;

export const POST_TYPES = {
  Post: [
    { name: 'username', type: 'string' },
    { name: 'contentType', type: 'string' },
    { name: 'caption', type: 'string' },
    { name: 'imageHash', type: 'bytes32' },
    { name: 'createdAt', type: 'uint64' },
  ],
  PublishIntent: [
    { name: 'post', type: 'Post' },
    { name: 'chainIds', type: 'uint256[]' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

/** Receipt domain: deliberately different from the intent domain, so neither can pass for the other (ADR-015). */
export const RECEIPTS_DOMAIN = { name: 'Onchain Receipts', version: '1' } as const;

export const RECEIPT_TYPES = {
  Receipt: [
    { name: 'postHash', type: 'bytes32' },
    { name: 'sigCommit', type: 'bytes32' },
    { name: 'acceptedAt', type: 'uint64' },
    { name: 'deadlines', type: 'Deadline[]' },
  ],
  Deadline: [
    { name: 'chainId', type: 'uint256' },
    { name: 'anchorBy', type: 'uint64' },
  ],
} as const;

export type Post = { username: string; contentType: string; caption: string; imageHash: Hex; createdAt: bigint };
export type PublishIntent = { post: Post; chainIds: bigint[]; nonce: Hex; deadline: bigint };
export type Deadline = { chainId: bigint; anchorBy: bigint };
export type Receipt = { postHash: Hex; sigCommit: Hex; acceptedAt: bigint; deadlines: Deadline[] };

/** keccak256 of the final image bytes, or the zero hash for a post without image. */
export function imageHash(image: Uint8Array | null): Hex {
  return image ? keccak256(image) : zeroHash;
}

/** Content identity, identical on every chain: hashStruct(Post). */
export function postHash(post: Post): Hex {
  return hashStruct({ data: post, primaryType: 'Post', types: POST_TYPES });
}

export function publishIntentDigest(intent: PublishIntent): Hex {
  return hashTypedData({ domain: POSTS_DOMAIN, types: POST_TYPES, primaryType: 'PublishIntent', message: intent });
}

export function recoverIntentSigner(intent: PublishIntent, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ domain: POSTS_DOMAIN, types: POST_TYPES, primaryType: 'PublishIntent', message: intent, signature });
}

/** Commitment to the user's signature, stored in the leaf instead of the signature itself (ADR-013). */
export function sigCommit(signature: Hex): Hex {
  return keccak256(signature);
}

export function receiptDigest(receipt: Receipt): Hex {
  return hashTypedData({ domain: RECEIPTS_DOMAIN, types: RECEIPT_TYPES, primaryType: 'Receipt', message: receipt });
}

export function recoverReceiptSigner(receipt: Receipt, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ domain: RECEIPTS_DOMAIN, types: RECEIPT_TYPES, primaryType: 'Receipt', message: receipt, signature });
}
