# ADR-014: Data model, leaf, manifest, tags, proof bundle and versioning

Status: Accepted
Confidence: Medium
Reversibility: One-way door (per schema version: stored Arweave data and anchored leaves are permanent; a new version can change the format for future posts)
Date: 2026-11-07
Updated: 2026-11-09

## Context

Five artefacts must agree byte for byte across browser, backend and verifier ([ADR-012](ADR-012-signature-scheme-eip712.md), [ADR-005](ADR-005-commitment-merkle-tree.md)):

- the post JSON stored on Arweave;
- the Merkle leaf;
- the batch manifest stored on Arweave (one per batch and chain);
- the public Arweave tags;
- the proof bundle a verifier consumes as untrusted hints.

They also have to respect A1 (no user address or public key anywhere public, [ADR-013](ADR-013-author-privacy-sigcommit.md)) and keep verification possible from public sources alone. All schemas live in `packages/core`, shared by web, backend and verifier.

## Decision

### Post JSON on Arweave

```json
{ "schema": "onchain-posts.post/1", "type": "post", "username": "ana", "caption": "...", "createdAt": 1762480000,
  "image": { "arweaveId": "...", "hash": "0x...", "mime": "image/webp", "bytes": 81234, "width": 1080, "height": 1080 },
  "postHash": "0x..." }
```

(Values Illustrative.)

- `image.arweaveId` is a locator outside the hash: if it pointed to other bytes, the downloaded bytes would not match `image.hash` (the signed `imageHash`), so tampering is detected.
- The post JSON cannot reference its batch or manifest: it is uploaded before the batch exists. Discovery is solved by the proof bundle and the hints endpoint below, not by the post JSON.

### Leaf

```
leaf = keccak256(bytes.concat(keccak256(abi.encode(postHash, postArweaveId, sigCommit))))
```

- `postArweaveId` is the 43-character base64url Arweave ID of the post JSON, decoded to 32 bytes.
- `sigCommit = keccak256(signature)` ([ADR-013](ADR-013-author-privacy-sigcommit.md)).
- No `chainId`: a batch belongs to one chain; the identity of a batch is `(chainId, sender, root)` ([ADR-008](ADR-008-multichain-orchestration.md)).
- `verifyPost` in the contract receives `abi.encode(postHash, postArweaveId, sigCommit)` as opaque `leafData` and applies the same double hash ([ADR-009](ADR-009-anchor-contract.md)), so the leaf format can change in a later version without touching the immutable contract.
- The batcher deduplicates by `postHash` within a batch.

### Manifest JSON (one per batch and chain, on Arweave)

```json
{ "schema": "onchain-posts.manifest/1", "chainId": 84532, "root": "0x...", "leafEncoding": ["bytes32","bytes32","bytes32"],
  "leaves": [["<postHash>","<postArweaveId>","<sigCommit>"], ...] }
```

- Every leaf value is a `0x`-prefixed hex `bytes32`; `postArweaveId` is the decoded Arweave ID in hex, not base64url.
- Reconstructible with OpenZeppelin `StandardMerkleTree.of(leaves, leafEncoding)` from `@openzeppelin/merkle-tree`, which uses the same double leaf hashing as `verifyPost`.
- OZ sorts leaves by hash by default and hashes each pair of internal nodes in sorted order. Other implementations must do the same to obtain the same root.
- No batch number: it is unknown until the transaction lands. The manifest is identified by `(chainId, root)`; the `BatchAnchored` event links `root`, `manifestId` and the chain.
- No tag per post hash on the manifest: ANS-104 allows at most 128 tags per data item, with tag names up to 1024 bytes and values up to 3072 bytes (Verified 2026-11-07, see Evidence), so that path does not scale to Nmax = 500 (design parameter, [ADR-006](ADR-006-batching-policy.md)).

### Arweave tags (public, indexed)

| Data item | Tags |
| --------- | ---- |
| Image | `Content-Type: image/webp`, `App-Name: Onchain-Posts`, `Type: post-image`, `Image-Hash` |
| Post JSON | `Content-Type: application/json`, `App-Name`, `Schema: onchain-posts.post/1`, `Type: post`, `Post-Hash` |
| Manifest | `Content-Type: application/json`, `App-Name`, `Type: batch-manifest`, `Chain-Id`, `Merkle-Root` |

No `username` tag. The platform controls the index and does not publish an indexable user dimension. The content itself remains public by design.

- This adds friction against third-party profile enumeration; it is not real privacy, because the post JSON with the username is public.
- It also minimises personal data in permanently indexed metadata and avoids stale tags after a username change.
- Trade-off: third-party clients cannot query by user; the platform relies on its own index.

### Proof bundle

Consumed by the verifier as untrusted hints ([ADR-015](ADR-015-signed-receipts.md), README section 9).

```json
{ "schema": "onchain-posts.proof/1", "postHash": "0x...", "postArweaveId": "...", "imageArweaveId": "...",
  "anchors": [ { "chainId": 84532, "sender": "0x...", "root": "0x...", "manifestId": "...", "txHash": "0x...",
                 "leafData": "0x...", "proof": ["0x...", "..."] } ],
  "pending": [ { "chainId": 11155111, "anchorBy": 1762480600 } ],
  "receipt": { "...": "ADR-015" },
  "signature": "0x... (optional, private copy only)",
  "intent": { "chainIds": [84532, 421614], "nonce": "0x...", "deadline": 1762481000 } }
```

(Values Illustrative. `intent` is optional and private, like `signature`; see below.)

Who produces what:

| Copy | Produced by | Contents | Notes |
| ---- | ----------- | -------- | ----- |
| Public | Backend, served by `GET /proof/:postHash` | Everything except `signature` and `intent` | PARTIAL while some chains are pending: anchored chains under `anchors`, chains still in the pipeline under `pending`, each with the `anchorBy` taken from the receipt |
| Private | The web app, in the client | The public bundle plus the locally held `signature` and `intent` fields | The backend never adds the signature to a bundle |

- `pending` is a hint like everything else from the backend: it can show that a deadline has passed, but it cannot establish an omission on its own. The "omitted" verdict requires the bounded event scan described in [ADR-015](ADR-015-signed-receipts.md).
- The `anchorBy` values are trustworthy only because they are read from the receipt, which is signed (EIP-712, "Onchain Receipts" domain, [ADR-015](ADR-015-signed-receipts.md)) by a key listed with role `receipt` in `config/trusted-keys.json`.
- Local storage rule: the web app persists each signature and its `intent` fields in IndexedDB, keyed by `postHash` and bound to the logged-in Openfort user, so the private bundle can be built in a later session.
- Limits: a shared or compromised browser leaks the signatures stored there; clearing site data or losing the device loses the local copy, and the only fallback is the on-demand disclosure from the backend ([ADR-013](ADR-013-author-privacy-sigcommit.md)).
- The backend never decrypts the user's signature to put it in a bundle, and never sends it over the network except in that explicit, authenticated, logged disclosure.

Principle: untrusted hints, independent verification. The verifier treats both sources (bundle file and API) as untrusted input and re-derives everything from Arweave, public RPCs and `config/trusted-keys.json`. This gives the proof bundle a concrete use beyond disclosure.

### Versioning

- `schema` in the JSON and as a tag; `version` in the EIP-712 domain; `schema` in the proof bundle.
- A breaking change means a new version; old data keeps its version forever.
- The contract is unaffected: the leaf is opaque to it.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| `postArweaveId` inside the leaf (chosen) | Verification goes root, leaf, gateway GET by ID, with no dependency on GraphQL or indexers; pins the canonical copy if the same post was uploaded twice (for example a retry) with the same `Post-Hash` tag; works if indexes are down or lagging | +32 B per leaf (96 B vs 64 B, manifest +50%) | Chosen |
| Lookup by `Post-Hash` tag via GraphQL | Smaller leaf | Indexer dependency; duplicates are ambiguous | Weaker verification path |
| `username` tag | Third-party clients can query by user | Indexable user dimension in permanent metadata; stale after rename | Privacy friction lost for a convenience |
| One `Post-Hash` tag per post on the manifest | Find the manifest of a post by tag | ANS-104 limit of 128 tags per data item | Does not scale to Nmax |
| Post JSON referencing its batch | Direct discovery | Not possible: the post is uploaded before the batch exists | Discovery via proof bundle and hints instead |
| Canonical JSON as the hashed format | Human-readable | Canonicalisation issues ([ADR-012](ADR-012-signature-scheme-eip712.md)) | EIP-712 hash is the identity; JSON is only a container |

## Consequences

Positive:

- A verifier needs only `postHash` plus public sources; hints speed it up but are never trusted.
- Off-chain trees are rebuilt with standard tooling (`@openzeppelin/merkle-tree`).
- The contract never freezes the leaf format.

Negative:

- Proof generation depends on the manifest being available on Arweave (trust assumption, [ADR-005](ADR-005-commitment-merkle-tree.md)).
- Third-party clients cannot query posts by user.
- The private bundle is only as safe as the browser that stores it.

Follow-ups:

- Done: zod schemas and TypeScript types in `packages/core` (`src/schemas.ts`), used by web, backend and verifier, with a Merkle fixture also checked by Foundry.

Deviation from the initial design notes: the private bundle carries an `intent` object (`chainIds`, `nonce`, `deadline`) next to `signature`. Without those fields the `PublishIntent` digest cannot be recomputed, so the signature alone would not prove authorship ([ADR-013](ADR-013-author-privacy-sigcommit.md)).

## Evidence

- ANS-104 (canonical spec, Verified 2026-11-07: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md): "there are <= 128 tags", "each key is <= 1024 bytes", "each value is <= 3072 bytes"; `owner` is "The public key of the owner"; "The id of the DataItem, is the SHA256 digest of this signature"; optional `anchor` of up to 32 bytes. The research notes verified the tag limits on 2026-11-06 at https://cookbook.ar.io/tooling/specs/ans/ANS-104.html, which returned a 404 page on 2026-11-07; the canonical spec is cited instead.
- OpenZeppelin merkle-tree: "The leaves are sorted", "The leaves are double-hashed", `sortLeaves` default `true`, and internal nodes are concatenated as "a sorted pair" (Verified 2026-11-07: https://github.com/OpenZeppelin/merkle-tree, README).
- Manifest size per entry and the free-tier fit: [ADR-006](ADR-006-batching-policy.md) (Estimate).
