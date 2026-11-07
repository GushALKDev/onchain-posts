# ADR-008: Multi-chain orchestration, failures and idempotency

Status: Accepted
Confidence: High
Reversibility: Reversible
Date: 2026-11-07

## Context

A user can choose up to three chains for one post (brief). Each chain has its own fees, latency and failure modes. The platform relayer sends every transaction (ADR-010), so it can send the same root to each chain directly; the question is how to keep anchors consistent with stored data and how to retry without anchoring the same posts twice.

## Decision

**Parallel, independent anchoring per chain** from the off-chain publisher. No cross-chain messaging.

**Pipeline invariant: no post enters a batch unless its data is stored on Arweave.** Anchors never point to missing data.

**Trust assumption.** Turbo makes data readable before final Arweave settlement; anchoring before settlement trusts Turbo to settle (ADR-002).

**Semantics.**

- Per-chain eventual consistency.
- No cross-chain atomicity: a post can be anchored on Base and still pending on Ethereum.
- No global ordering: the post time (`createdAt`) is inside the post; the anchor proves "existed before block time T" per chain.

**Batch identity: the root is not globally unique.** The leaf carries no chainId (ADR-014), so two chains queued with the same posts produce the same root, with different manifests (each manifest carries its chainId). The identity of a batch is **(chainId, sender, root)**. The contract is already local to each chain; the indexer and the verifier key on the triple.

**Idempotency.** The contract rejects an already anchored (sender, root) with `AlreadyAnchored` (ADR-009). Before any retry, the worker checks the receipt of the original transaction.

**Failure types.**

| Type | What happened | Response |
| ---- | ------------- | -------- |
| Stuck or dropped | Never mined | Resend with the **same nonce** and a higher fee |
| Reverted | Mined but reverted (for example a duplicate root) | Bug or attack: alert, no blind retry |
| Unknown | RPC timeout, no answer | Check the receipt first; duplicates are blocked on-chain anyway |

**Re-batching a long-stuck batch.** A stuck batch can be re-batched with newer posts (new root and new manifest), but the new transaction **must be sent as a replacement with the same nonce** as the stuck one, so only one of the two versions can land. Otherwise, if the old transaction eventually lands too, the same posts are anchored twice under different roots (the contract cannot detect that: the roots differ).

- If the original transaction was dropped from the mempool, the nonce is still free and the same rule applies.
- If the state is unknown, check the receipt first.
- The old manifest becomes an orphan on Arweave: harmless (no anchor points to it), documented.
- Retries must complete before the receipt deadline `anchorBy` of each post in the batch (ADR-015).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Cross-chain messaging (CCIP, LayerZero, Hyperlane) | One source of truth, messages delivered to other chains | Extra fees, extra latency, trust in a bridge or oracle network | Nothing to gain: the relayer can send the same root to each chain |
| Sequential anchoring (chain A, then B, then C) | Simpler state | One slow chain delays all others | Chains are independent |
| Atomic all-or-nothing across chains | Clean semantics | Not achievable without a cross-chain protocol; a failure on one chain would block the others | Eventual consistency per chain is enough for social content |
| Anchor before storage completes | Faster anchoring | Anchors could point to missing data | Violates the pipeline invariant |

## Consequences

Positive:

- Failures on one chain do not affect the others.
- Retries are safe: duplicates are rejected on-chain, and same-nonce replacement prevents double anchoring under different roots.

Negative:

- A post can be in different states on different chains; the UI shows status per chain (ADR-017).
- Orphan manifests can accumulate on Arweave after re-batches (small, permanent, paid).

Follow-ups:

- Implement the nonce manager and the replacement rule in the anchor worker (ADR-016) with tests for the three failure types.

## Evidence

- Design-level ADR; tests pending (anchor worker).
