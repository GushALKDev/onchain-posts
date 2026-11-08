import { bytesToHex, hexToBytes, recoverMessageAddress, type Hex } from 'viem';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import { ApiError } from '../errors.ts';
import { decryptSignature, hmacAddress } from '../privacy.ts';

export const DISCLOSURE_MAX_AGE_SECONDS = 300;

/** Message the author signs with the same key to prove they own the post they ask about. */
export const disclosureMessage = (postHash: Hex, issuedAt: number) => `Onchain Posts signature disclosure\npostHash: ${postHash}\nissuedAt: ${issuedAt}`;

const DisclosureSchema = z.strictObject({
  postHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  issuedAt: z.int().nonnegative(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

/**
 * POST /disclosure: returns the stored signature and private intent fields only to the author, proven by a fresh
 * signature over a disclosure message, and records the disclosure in the audit log (ADR-013).
 */
export async function disclose(deps: Deps, body: unknown) {
  const parsed = DisclosureSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'invalid-body', parsed.error.issues[0]?.message ?? 'invalid body');
  const { issuedAt, signature } = parsed.data;
  const postHash = parsed.data.postHash.toLowerCase() as Hex;
  if (Math.abs(deps.now() - issuedAt) > DISCLOSURE_MAX_AGE_SECONDS) throw new ApiError(400, 'stale-request', 'issuedAt is too far from server time');

  let requester;
  try {
    requester = await recoverMessageAddress({ message: disclosureMessage(postHash, issuedAt), signature: signature as Hex });
  } catch {
    throw new ApiError(400, 'signature', 'signature could not be recovered');
  }
  const key = Buffer.from(hexToBytes(postHash));
  const [post] = await deps.sql<{ signer_hmac: Buffer; signature_enc: Buffer; chain_ids: number[]; intent_nonce: Buffer; intent_deadline: string }[]>`
    SELECT signer_hmac, signature_enc, chain_ids, intent_nonce, intent_deadline FROM posts WHERE post_hash = ${key}`;
  const requesterHmac = hmacAddress(deps.config.dbHmacSecret, requester);
  if (!post || !post.signer_hmac.equals(requesterHmac)) throw new ApiError(403, 'not-author', 'only the author can request this signature');

  const userSignature = decryptSignature(deps.keyStore.symmetricKey(deps.config.keyRefs.signatureEncryption), postHash, post.signature_enc);
  await deps.sql`INSERT INTO disclosure_log (post_hash, signer_hmac) VALUES (${key}, ${requesterHmac})`;
  return { signature: userSignature, intent: { chainIds: post.chain_ids, nonce: bytesToHex(post.intent_nonce), deadline: Number(post.intent_deadline) } };
}
