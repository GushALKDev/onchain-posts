import { zeroHash, type Hex } from 'viem';
import { CONTENT_TYPE_POST } from './constants.ts';
import type { Post, Receipt } from './eip712.ts';
import type { PostJson, SignedReceipt } from './schemas.ts';

/** Rebuilds the signed Post from the post JSON stored on Arweave; the verifier recomputes postHash from it. */
export function postFromJson(json: PostJson): Post {
  return {
    username: json.username,
    contentType: CONTENT_TYPE_POST,
    caption: json.caption,
    imageHash: (json.image?.hash ?? zeroHash) as Hex,
    createdAt: BigInt(json.createdAt),
  };
}

/** Typed EIP-712 message of a signed receipt (the JSON uses numbers, EIP-712 uses bigints). */
export function receiptFromJson(json: SignedReceipt): Receipt {
  return {
    postHash: json.postHash as Hex,
    sigCommit: json.sigCommit as Hex,
    acceptedAt: BigInt(json.acceptedAt),
    deadlines: json.deadlines.map((d) => ({ chainId: BigInt(d.chainId), anchorBy: BigInt(d.anchorBy) })),
  };
}
