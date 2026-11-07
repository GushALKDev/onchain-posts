import { z } from 'zod';
import { LIMITS, MANIFEST_SCHEMA, POST_SCHEMA, PROOF_SCHEMA, TRUSTED_KEYS_SCHEMA } from './constants.ts';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 32-byte hex');
const hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, 'expected hex bytes');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected address');
const arweaveId = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'expected 43-character base64url Arweave ID');
const unixSeconds = z.int().nonnegative();
const chainId = z.int().positive();

/** Post JSON stored on Arweave (ADR-014). Strict: permanent data must not carry unexpected fields. */
export const PostJsonSchema = z.strictObject({
  schema: z.literal(POST_SCHEMA),
  type: z.literal('post'),
  username: z.string(),
  caption: z.string(),
  createdAt: unixSeconds,
  image: z
    .strictObject({
      arweaveId,
      hash: hex32,
      mime: z.literal('image/webp'),
      bytes: z.int().positive().max(LIMITS.imageMaxBytes),
      width: z.int().positive().max(LIMITS.imageMaxSide),
      height: z.int().positive().max(LIMITS.imageMaxSide),
    })
    .nullable(),
  postHash: hex32,
});

export const ManifestSchema = z.strictObject({
  schema: z.literal(MANIFEST_SCHEMA),
  chainId,
  root: hex32,
  leafEncoding: z.tuple([z.literal('bytes32'), z.literal('bytes32'), z.literal('bytes32')]),
  leaves: z.array(z.tuple([hex32, hex32, hex32])).min(1),
});

export const DeadlineSchema = z.strictObject({ chainId, anchorBy: unixSeconds });

/** Signed receipt as served to the user and embedded in proof bundles (ADR-015). */
export const SignedReceiptSchema = z.strictObject({
  postHash: hex32,
  sigCommit: hex32,
  acceptedAt: unixSeconds,
  deadlines: z.array(DeadlineSchema).min(1).max(LIMITS.maxChainsPerPost),
  signature: hex,
});

/** Proof bundle: untrusted hints for the verifier. signature and intent appear only in the user's private copy (ADR-014). */
export const ProofBundleSchema = z.strictObject({
  schema: z.literal(PROOF_SCHEMA),
  postHash: hex32,
  postArweaveId: arweaveId,
  imageArweaveId: arweaveId.nullable(),
  anchors: z.array(
    z.strictObject({
      chainId,
      sender: address,
      root: hex32,
      manifestId: arweaveId,
      txHash: hex32,
      leafData: z.string().regex(/^0x[0-9a-fA-F]{192}$/, 'expected 96-byte leaf data'),
      proof: z.array(hex32),
    }),
  ),
  pending: z.array(DeadlineSchema),
  receipt: SignedReceiptSchema,
  signature: hex.optional(),
  intent: z.strictObject({ chainIds: z.array(chainId).min(1).max(LIMITS.maxChainsPerPost), nonce: hex32, deadline: unixSeconds }).optional(),
});

const keyWindow = { address, validFrom: z.iso.datetime(), revokedAt: z.iso.datetime().nullable(), note: z.string() };

/** config/trusted-keys.json: relayer keys are per chain; receipt keys are chain-agnostic (ADR-009). */
export const TrustedKeySchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('relayer'), chainId, ...keyWindow }),
  z.strictObject({ role: z.literal('receipt'), chainId: z.null(), ...keyWindow }),
]);

export const TrustedKeysFileSchema = z.strictObject({
  schema: z.literal(TRUSTED_KEYS_SCHEMA),
  description: z.string(),
  keys: z.array(TrustedKeySchema).min(1),
});

export type PostJson = z.infer<typeof PostJsonSchema>;
export type ManifestJson = z.infer<typeof ManifestSchema>;
export type SignedReceipt = z.infer<typeof SignedReceiptSchema>;
export type ProofBundle = z.infer<typeof ProofBundleSchema>;
export type TrustedKey = z.infer<typeof TrustedKeySchema>;
export type TrustedKeysFile = z.infer<typeof TrustedKeysFileSchema>;
