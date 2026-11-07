# ADR-007: Chain selection

Status: Accepted
Confidence: Medium
Reversibility: Reversible (per-chain adapter; the same contract deploys anywhere EVM)
Date: 2026-11-07

## Context

The brief asks for three blockchains, with the user able to publish the same post on up to three of them at once. The efficiency story (ADR-001) needs at least one chain where gas is expensive, so batching visibly matters, and chains where latency is low. The deadline is Friday 2026-11-13, so one codebase for all three chains is a strong constraint.

## Decision

**Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia.** The same `PostAnchor` contract on all three, at the same CREATE2 address (ADR-009).

| Chain | Chain ID | Role in the design |
| ----- | -------- | ------------------ |
| Ethereum Sepolia | 11155111 | L1: where each transaction costs most and batching saves the most money |
| Base Sepolia | 84532 | L2: low latency (200 ms blocks, ADR-006) |
| Arbitrum Sepolia | 421614 | L2 on a different rollup stack (Arbitrum Nitro) |

Chain IDs Verified 2026-11-07 with `eth_chainId` on public RPC endpoints (https://ethereum-sepolia-rpc.publicnode.com returned `0xaa36a7`, https://sepolia.base.org returned `0x14a34`, https://sepolia-rollup.arbitrum.io/rpc returned `0x66eee`).

**Rationale.**

- Ethereum (L1) shows where batching saves the most money; the two L2s show latency.
- One codebase: EVM, viem, one contract.
- Two different rollup stacks (Base and Arbitrum Nitro) give some diversity. Base's current stack lineage is To verify: one source reported Base announcing a move off the OP Stack in 2026, not confirmed. This ADR therefore does not label Base as "OP Stack".
- Testnet fees are not representative: money figures come from mainnet prices and mainnet L1 data fee oracles (ADR-001).

**Solana: considered and discarded for time** given the deadline. How it would fit without rewriting the design:

- No contract there; the anchor is a memo transaction (Memo program) signed by the relayer key, carrying the root and the manifest ID.
- Deduplication of (sender, root) moves off-chain, because a memo has no state to reject a duplicate.
- Same trust model: a trusted sender listed in `config/trusted-keys.json`.

Listed as future work; not planned for this delivery.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| OP Mainnet (Sepolia) | Mature L2, cheap | Historically the same stack family as Base, so low diversity (To verify, given the Base lineage note above) | Arbitrum gives more stack diversity |
| Polygon PoS | Large ecosystem, RWA presence | Different security model (not a rollup); adds a third execution environment to reason about | Less useful for the L1 vs L2 comparison |
| Solana via the Memo program | Non-EVM demonstration; very cheap | TypeScript-only adapter, different tooling, off-chain dedup | Dropped for time |
| Irys L1 | Storage-native chain | Young chain; overlaps with the storage decision (ADR-002) | Not a settlement chain we need |

## Consequences

Positive:

- One contract, one adapter type, three deployments.
- The benchmark covers both L1 pricing and L2 pricing with an L1 data fee.

Negative:

- **What we give up:** the non-EVM "any chain" demonstration.
- Mitigation: a per-chain adapter design (submit, track, read events), so a non-EVM adapter can be added without touching the rest of the pipeline.

Follow-ups:

- Confirm Base's stack lineage and its L1 data fee oracle (ADR-001).

## Evidence

- Chain IDs: Verified 2026-11-07 (above).
- To verify: Base stack lineage; OP Mainnet relationship to Base after that check.
