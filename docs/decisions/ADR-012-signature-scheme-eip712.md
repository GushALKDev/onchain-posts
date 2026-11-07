# ADR-012: Signature scheme: EIP-712, content separated from intent

Status: Accepted
Confidence: High
Reversibility: Reversible (via a version bump in the domain and schemas; signatures already committed stay v1)
Date: 2026-11-07

## Context

The user authorises a post off-chain; the relayer anchors it ([ADR-010](ADR-010-gasless-relayer.md)). Two different things need a hash:

- The content, which must be identical on every chain so the same `postHash` can be found on each of them.
- The authorisation, which says on which chains, until when and with which nonce the user allows publication.

The signature must also be checkable by the backend, recomputable by any verifier, never published (A1: an ECDSA signature reveals the public key through `ecrecover`, [ADR-013](ADR-013-author-privacy-sigcommit.md)) and, if ever needed, verifiable in Solidity.

## Decision

Content (`Post`) and intent (`PublishIntent`) are separate EIP-712 structs.

```
Domain: { name: "Phi Posts", version: "1", verifyingContract: <PostAnchor CREATE2 address, same on all chains> }
        (no chainId; see the ADR-011 fallback if the signer requires one: a constant chainId used as a namespace)

Post          { string username; string contentType; string caption; bytes32 imageHash; uint64 createdAt }
PublishIntent { Post post; uint256[] chainIds; bytes32 nonce; uint64 deadline }

postHash  = hashStruct(Post)
imageHash = keccak256(image bytes), or 0x0 if there is no image
```

The user signs `PublishIntent`. `postHash` is the content identity used everywhere else: in the leaf ([ADR-014](ADR-014-data-model.md)), in the receipt ([ADR-015](ADR-015-signed-receipts.md)) and in the post JSON on Arweave.

### The signature freezes the content

Everything inside the hash must reach its final form in the client, before signing (shared constraint with [ADR-003](ADR-003-arweave-layout-image-limits.md)):

- `username` and `caption` are normalised to NFC; `username` is lowercase with charset `[a-z0-9_]`.
- The image reaches its final bytes (WebP, no EXIF or XMP chunks) before `imageHash` is computed.
- The server recomputes `imageHash` and `postHash` and compares. It never normalises or transforms: it rejects.
- `packages/core` exposes the same normalisation and hashing functions to web, backend and verifier, so the three cannot drift.

### Deadline semantics

`deadline` is checked by the backend at acceptance time, not at anchoring time: the contract never sees the intent. A post accepted before its deadline may be anchored after it. This is by design: once accepted, the platform's obligation is expressed by the receipt's per-chain `anchorBy` ([ADR-015](ADR-015-signed-receipts.md)), not by the intent's deadline.

### Backend security checks

| Check | Why |
| ----- | --- |
| The username belongs to the signer | Otherwise anyone could post as "ana" |
| Normalisation is verified, not applied | A non-normalised string is rejected; unicode confusables are handled by the restricted username charset |
| `createdAt` within a few minutes of server time (design parameter: exact skew set in the backend block) | `createdAt` is client-declared and untrusted; the anchor gives the strong "existed before T" proof |
| `nonce` is random (32 bytes) and stored once used | A sequential nonce would reveal how many posts a user made if an intent were ever disclosed; storage blocks reuse |
| `deadline` not passed at acceptance | Limits the life of a leaked, unused signature |
| `chainIds` is non-empty, has no duplicates, has at most 3 entries and only supported chains | The brief: up to 3 chains, chosen by the user |

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| EIP-712, content and intent separated (chosen) | Exactly what is signed is what is hashed; deterministic encoding; wallet support; verifiable in Solidity if needed | Requires the signer to support typed data (and possibly a domain without `chainId`, To verify in [ADR-011](ADR-011-identity-openfort.md)) | Chosen |
| Canonical JSON (for example JCS) + `personal_sign` | Human-readable payload | Key order, whitespace and unicode-escape issues; needs a canonicaliser in browser, backend and verifier; not natural in Solidity | More ways to disagree on bytes |
| One struct with `chainIds` inside the content | One hash | `postHash` would differ per chain selection, so "the same post on 3 chains" would not share one identity | Breaks cross-chain identity |
| Arweave ID of the image inside the signed content | Points to the location | Not known before upload, so the user would sign after upload; commits to a location instead of bytes | `imageHash` can be computed in the browser before upload and is storage-agnostic |
| Domain with the real `chainId` of each chain | Standard EIP-712 replay protection | The user would sign once per chain for the same post | `chainIds` are signed inside the intent instead |

## Consequences

Positive:

- Sign first, upload later: `imageHash` is computable in the browser before any upload.
- The same `postHash` identifies the post on every chain and on Arweave.
- One signature per post, whatever the number of chains.

Negative:

- Every transformation must happen in the client before signing; the server can only reject. A buggy client produces rejected posts, not silently altered ones.
- Accepted posts can be anchored after the intent deadline (documented, intended).

Follow-ups:

- [ADR-011](ADR-011-identity-openfort.md): confirm that Openfort signs a domain without `chainId`; otherwise apply the constant-`chainId` fallback.

### Chain-agnostic domain: replay analysis

| Threat | Outcome |
| ------ | ------- |
| A third party reuses the signature | Not possible for third parties: the signature is never published; only `keccak256(signature)` appears inside the leaf (`sigCommit`, [ADR-013](ADR-013-author-privacy-sigcommit.md)) |
| Anchoring on a chain the user did not choose | Only our relayer could do it under a trusted address; `chainIds` are signed and the backend enforces them; a violation is provable if the user reveals the signature. Third parties can only anchor under their own address, which verifiers do not trust ([ADR-009](ADR-009-anchor-contract.md)) |
| The same intent submitted twice | The backend stores used nonces; the deadline bounds the window |
| Reuse in another protocol | The domain name, version, verifying contract and the `PublishIntent` type match nothing else; no contract verifies this signature |
| A signature leaked later | Rejected after `deadline`; within the deadline, the nonce allows one acceptance only |

The same chain-agnostic domain pattern (one signature valid across chains, the chain set carried in the signed message) is used by multichain signature schemes ([ADR-010](ADR-010-gasless-relayer.md) cites examples).

## Evidence

- EIP-712 domain fields are optional: "Protocol designers only need to include the fields that make sense for their signing domain. Unused fields are left out of the struct type." (Verified 2026-11-07: https://eips.ethereum.org/EIPS/eip-712).
- Tests to add in a later block: `packages/core` unit tests that hash `Post` and `PublishIntent` identically in browser and Node, and a Foundry test that recomputes `hashStruct(Post)` in Solidity against the TypeScript output.
- To verify: Openfort support for a domain without `chainId` and how it exposes the signer EOA signature ([ADR-011](ADR-011-identity-openfort.md)).
