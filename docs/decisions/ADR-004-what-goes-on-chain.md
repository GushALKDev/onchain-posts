# ADR-004: What goes on-chain

Status: Accepted
Confidence: High
Reversibility: One-way door (anchors are permanent and PostAnchor is immutable, ADR-009; a different on-chain format needs a new contract)
Date: 2026-11-07

## Context

Every byte written on-chain is paid on each chain the user chooses (up to three), and contract storage is the most expensive resource in the EVM. The brief requires that publication happens on-chain, so "nothing on-chain" is not an option. Content is already stored permanently on Arweave (ADR-002), so the chain only needs a commitment that proves the content existed at a time and was published by the platform.

## Decision

On each chain, per batch: **only the batch Merkle root (32 bytes) plus one storage slot** (`anchoredAt[sender][root]`, ADR-009). The manifest ID and the post count travel in the event only. **Nothing per post on-chain.**

The post hash commits to the image **bytes** (`imageHash = keccak256(image bytes)`), not to where the image is stored, so the commitment is storage-agnostic: if the storage layer changed, already anchored posts would still verify against any copy of the same bytes (ADR-012, ADR-014).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Caption in storage | Readable from contract state | About 20k gas per new 32-byte word (Estimate: 20,000 SSTORE zero to non-zero, plus 2,100 cold access); a 1,000-byte caption is about 730k gas (ADR-001, B0) | Cost grows with content and is paid on every chain |
| Caption in event or calldata | Cheaper than storage; readable by indexers | Still linear in caption length (16 gas per non-zero calldata byte + 8 gas per log byte, Estimate) and pays the L1 data fee per byte on L2s | Duplicates data already on Arweave |
| Hash + Arweave pointer per post | Per-post on-chain lookup | One write per post per chain | No batching benefit |
| Hash only, per post (B1) | Simple; per-post event | One tx per post per chain: about 25k gas each (Estimate, ADR-001) | Loses batching; ours is cheaper from about N = 2 |
| Hash list per batch (B2) | Batching; leaves available on-chain | Calldata grows linearly with N; contract-level inclusion needs the whole list | Cheaper than ours below about N = 34 on L1 (Estimate, ADR-001); chosen against in ADR-005 for constant size, with a revisit criterion |
| Nothing on-chain | Zero gas | Fails the brief | Not an option |

## Consequences

Positive:

- On-chain cost per batch is constant at any N (ADR-001: about 47k gas per batch, Estimate).
- No user data, no content and no per-post identifier is written on-chain, which supports requirement A1 (ADR-013).

Negative:

- Reading a post requires Arweave plus the manifest; the chain alone cannot show content.
- Proof generation depends on the manifest being available on Arweave (ADR-005 trust assumption).

Follow-ups:

- Confirm the per-batch gas with `forge snapshot` (ADR-001).

## Evidence

- Gas figures: Estimates derived in ADR-001; pending benchmark results.
