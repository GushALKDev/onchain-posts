import {
  CONTENT_TYPE_POST,
  LIMITS,
  checkCaption,
  checkUsername,
  imageHash,
  inspectWebp,
  postHash as hashPost,
  recoverIntentSigner,
  sigCommit,
  type SignedReceipt,
} from '@phi/core';
import { hexToBytes, zeroHash, type Hex } from 'viem';
import { z } from 'zod';
import { INTENT_RULES } from '../config.ts';
import type { Deps } from '../deps.ts';
import { ApiError } from '../errors.ts';
import { encryptSignature, hmacAddress } from '../privacy.ts';
import { anchorByFor, signReceipt } from '../receipts.ts';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** POST /posts body. The signature must be a plain 65-byte EOA signature (Openfort EOA account type, ADR-011). */
export const SubmitSchema = z.strictObject({
  intent: z.strictObject({
    post: z.strictObject({ username: z.string(), contentType: z.string(), caption: z.string(), imageHash: hex32, createdAt: z.int().nonnegative() }),
    chainIds: z.array(z.int().positive()).min(1).max(LIMITS.maxChainsPerPost),
    nonce: hex32,
    deadline: z.int().nonnegative(),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'expected a 65-byte EOA signature'),
  /** Final WebP bytes, base64. null for a post without image. */
  image: z.string().nullable(),
});

const bad = (code: string, message: string) => new ApiError(400, code, message);

function decodeImage(base64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw bad('image-encoding', 'image must be base64');
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Accepts a signed PublishIntent: every check of ADR-003, ADR-012 and ADR-016 runs before anything is stored. The
 * server never transforms content (the signature freezes it); it recomputes, compares and rejects.
 */
export async function acceptPost(deps: Deps, body: unknown): Promise<{ postHash: Hex; receipt: SignedReceipt }> {
  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) throw bad('invalid-body', parsed.error.issues[0]?.message ?? 'invalid body');
  const { intent, signature, image } = parsed.data;
  const now = deps.now();

  if (intent.post.contentType !== CONTENT_TYPE_POST) throw bad('content-type', 'contentType must be "post"');
  if (new Set(intent.chainIds).size !== intent.chainIds.length) throw bad('chains', 'chainIds must not repeat');
  const chains = intent.chainIds.map((id) => deps.config.chains.find((c) => c.chainId === id));
  if (chains.some((c) => !c)) throw bad('chains', 'unsupported chain');
  if (intent.deadline <= now) throw bad('deadline', 'intent deadline has passed');
  if (intent.deadline > now + INTENT_RULES.maxDeadlineAheadSeconds) throw bad('deadline', 'intent deadline is too far ahead');
  if (Math.abs(intent.post.createdAt - now) > INTENT_RULES.maxCreatedAtSkewSeconds) throw bad('created-at', 'createdAt is too far from server time');

  const username = checkUsername(intent.post.username);
  if (!username.ok) throw bad('username', username.reason);
  const caption = checkCaption(intent.post.caption);
  if (!caption.ok) throw bad('caption', caption.reason);

  let imageBytes: Uint8Array | null = null;
  let imageMeta: { bytes: number; width: number; height: number } | null = null;
  if (intent.post.imageHash === zeroHash) {
    if (image !== null) throw bad('image', 'imageHash is zero but an image was sent');
  } else {
    if (image === null) throw bad('image', 'imageHash is set but no image was sent');
    imageBytes = decodeImage(image);
    if (imageBytes.length > LIMITS.imageMaxBytes) throw bad('image-size', `image is ${imageBytes.length} bytes, max ${LIMITS.imageMaxBytes}`);
    let info;
    try {
      info = inspectWebp(imageBytes);
    } catch (error) {
      throw bad('image-format', `not a valid WebP: ${(error as Error).message}`);
    }
    if (info.disallowed.length > 0) throw bad('image-metadata', `image carries chunks outside the allowlist: ${info.disallowed.join(', ')}`);
    if (info.width > LIMITS.imageMaxSide || info.height > LIMITS.imageMaxSide) throw bad('image-dimensions', `image is ${info.width}x${info.height}, max side ${LIMITS.imageMaxSide}`);
    if (imageHash(imageBytes) !== intent.post.imageHash.toLowerCase()) throw bad('image-hash', 'image bytes do not match imageHash');
    imageMeta = { bytes: imageBytes.length, width: info.width, height: info.height };
  }

  const post = { ...intent.post, imageHash: intent.post.imageHash as Hex, createdAt: BigInt(intent.post.createdAt) };
  const typedIntent = { post, chainIds: intent.chainIds.map(BigInt), nonce: intent.nonce as Hex, deadline: BigInt(intent.deadline) };
  let signer;
  try {
    signer = await recoverIntentSigner(typedIntent, signature as Hex);
  } catch {
    throw bad('signature', 'signature could not be recovered');
  }
  // From here on the address exists only in memory: it is never logged and only its HMAC is stored (ADR-013).
  const signerHmac = hmacAddress(deps.config.dbHmacSecret, signer);
  if (!deps.limiter.allow(`signer:${signerHmac.toString('hex')}`, deps.config.limits.postsPerSignerPerMinute, 60)) {
    throw new ApiError(429, 'rate-limited', 'too many posts from this account');
  }
  const [counts] = await deps.sql<{ today: number }[]>`SELECT count(*)::int AS today FROM posts WHERE accepted_at > ${now - 86_400}`;
  const today = counts?.today ?? 0;
  if (today >= deps.config.limits.postsPerDay) throw new ApiError(503, 'daily-cap', 'daily posting budget reached');

  const postHash = hashPost(post);
  const commit = sigCommit(signature as Hex);
  const receipt = await signReceipt(deps.keyStore.evmAccount(deps.config.keyRefs.receipt), {
    postHash,
    sigCommit: commit,
    acceptedAt: now,
    deadlines: chains.map((c) => ({ chainId: c!.chainId, anchorBy: anchorByFor(now, c!) })),
  });
  const encrypted = encryptSignature(deps.keyStore.symmetricKey(deps.config.keyRefs.signatureEncryption), postHash, signature as Hex);

  try {
    await deps.sql.begin(async (tx) => {
      await tx`INSERT INTO usernames (username, signer_hmac) VALUES (${intent.post.username}, ${signerHmac}) ON CONFLICT (username) DO NOTHING`;
      const [owner] = await tx<{ signer_hmac: Buffer }[]>`SELECT signer_hmac FROM usernames WHERE username = ${intent.post.username}`;
      if (!owner || !owner.signer_hmac.equals(signerHmac)) throw new ApiError(403, 'username-owner', 'username belongs to another account');

      await tx`
        INSERT INTO posts (post_hash, username, caption, created_at, image_hash, image_bytes, image_meta, chain_ids, signer_hmac,
                           intent_nonce, intent_deadline, sig_commit, signature_enc, receipt, accepted_at, state)
        VALUES (${Buffer.from(hexToBytes(postHash))}, ${intent.post.username}, ${intent.post.caption}, ${intent.post.createdAt},
                ${Buffer.from(hexToBytes(post.imageHash))}, ${imageBytes ? Buffer.from(imageBytes) : null}, ${imageMeta ? tx.json(imageMeta) : null},
                ${intent.chainIds}, ${signerHmac}, ${Buffer.from(hexToBytes(intent.nonce as Hex))}, ${intent.deadline},
                ${Buffer.from(hexToBytes(commit))}, ${encrypted}, ${tx.json(receipt)}, ${now}, 'RECEIVED')`;
      for (const d of receipt.deadlines) {
        await tx`INSERT INTO post_chains (post_hash, chain_id, anchor_by, state) VALUES (${Buffer.from(hexToBytes(postHash))}, ${d.chainId}, ${d.anchorBy}, 'WAITING')`;
      }
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const constraint = (error as { constraint_name?: string }).constraint_name;
    if (constraint === 'posts_pkey') throw new ApiError(409, 'duplicate-post', 'this post was already submitted');
    if (constraint === 'posts_signer_hmac_intent_nonce_key') throw new ApiError(409, 'nonce-reused', 'intent nonce already used');
    throw error;
  }
  return { postHash, receipt };
}
