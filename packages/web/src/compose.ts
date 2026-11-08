import {
  CONTENT_TYPE_POST,
  POSTS_DOMAIN,
  POST_TYPES,
  checkCaption,
  checkUsername,
  imageHash,
  normalizeCaption,
  normalizeUsername,
  postHash as hashPost,
  type PublishIntent,
} from '@phi/core';
import { bytesToHex, type Hex } from 'viem';
import type { PostSigner } from './signer.ts';

export type Draft = { username: string; caption: string; image: Uint8Array | null; chainIds: number[] };

export type SubmitBody = {
  intent: { post: { username: string; contentType: string; caption: string; imageHash: Hex; createdAt: number }; chainIds: number[]; nonce: Hex; deadline: number };
  signature: Hex;
  image: string | null;
};

export type BuiltSubmission = { body: SubmitBody; postHash: Hex; intent: PublishIntent; signature: Hex };

/** Intent validity window (design parameter); the backend accepts at most 1 hour ahead (ADR-012). */
export const INTENT_TTL_SECONDS = 600;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Freezes the post before signing: username and caption are normalised here and the image already holds its final
 * bytes, because the signature commits to them and the server only checks, never transforms (ADR-003, ADR-012).
 */
export async function buildSubmission(draft: Draft, signer: PostSigner, now: number, randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): Promise<BuiltSubmission> {
  const username = normalizeUsername(draft.username.trim());
  const caption = normalizeCaption(draft.caption);
  const usernameCheck = checkUsername(username);
  if (!usernameCheck.ok) throw new Error(usernameCheck.reason);
  const captionCheck = checkCaption(caption);
  if (!captionCheck.ok) throw new Error(captionCheck.reason);
  if (draft.chainIds.length === 0) throw new Error('choose at least one chain');

  const post = { username, contentType: CONTENT_TYPE_POST, caption, imageHash: imageHash(draft.image), createdAt: BigInt(now) };
  // A random nonce: a sequential one would reveal how many posts a user made if an intent were disclosed (ADR-012).
  const intent: PublishIntent = { post, chainIds: draft.chainIds.map(BigInt), nonce: bytesToHex(randomBytes(32)), deadline: BigInt(now + INTENT_TTL_SECONDS) };
  const signature = await signer.signTypedData({ domain: POSTS_DOMAIN, types: POST_TYPES, primaryType: 'PublishIntent', message: intent });

  return {
    postHash: hashPost(post),
    intent,
    signature,
    body: {
      intent: { post: { ...post, createdAt: now }, chainIds: draft.chainIds, nonce: intent.nonce, deadline: now + INTENT_TTL_SECONDS },
      signature,
      image: draft.image ? toBase64(draft.image) : null,
    },
  };
}
