# ADR-001: Efficiency definition and measurement method

Status: Accepted
Confidence: High
Reversibility: Reversible
Date: 2026-11-07

## Context

The brief asks for "the most efficient way possible" and says efficiency is what is evaluated. "Efficient" is not defined. A single number would hide the trade-offs that drive every other decision: batching trades latency for cost, Merkle trades a fixed storage slot for constant size, permanent storage trades money for durability. The live demo cannot prove efficiency either, because it runs small batches in demo mode (ADR-006).

## Decision

Efficiency is reported as four separate metrics, never collapsed into one:

| Metric | Unit | What it captures |
| ------ | ---- | ---------------- |
| End-to-end cost per post | USD | Storage (image + post JSON + share of the manifest) + anchoring x number of chains chosen |
| On-chain bytes per post | bytes | Calldata and log data attributable to one post |
| Gas per batch and per post | gas | Execution + intrinsic gas; per post = per batch / N |
| Latency per stage | seconds, p50 and p95 | Accepted, Published, Settled (ADR-017) |

**Scenarios.** Batch sizes N = 1, 10, 100, 500, 1000 on each of the three chains (design parameters).

**Baselines.** They live only in `contracts/bench` and are never deployed as product.

| ID | What it does | What it measures |
| -- | ------------ | ---------------- |
| B0 naive | Stores username, caption and imageHash in contract storage, one tx per post per chain | The cost of putting content on-chain |
| B1 | One tx per post per chain, emits only the postHash in an event | The cost of not batching |
| B2 | One tx per batch per chain, emits the N postHashes in an event (hash list, no tree) | The honest rival of a Merkle root: same batching, linear calldata, leaves available on-chain. The brief says Merkle is not required, so this is the alternative to beat |
| ours-lite | One tx per batch, emits only the root in an event, no storage slot | The price of on-chain idempotency and contract readability (measured instead of argued) |
| ours | One tx per batch anchoring a Merkle root with one storage slot (ADR-009) | The chosen design |

**Estimates, to be replaced by measured values.** All gas figures below are Estimates at L1 pricing.

| Variant | Gas | Derivation |
| ------- | --- | ---------- |
| B0 | about 100k to 200k per post with a short caption | Estimate: 21,000 intrinsic + a few new storage words at 22,100 each (20,000 SSTORE + 2,100 cold) for username, caption, imageHash and string length words |
| B0, 1,000-byte caption | about 730k for the caption alone | Estimate: ceil(1000 / 32) = 32 data words + 1 length word = 33 x 22,100 |
| B1 | about 25k per post | Estimate: 21,000 intrinsic + about 0.6k calldata (36 B) + about 1.4k LOG + dispatch |
| B2 | about 21k per tx + about 770 per post | Estimate: 32 B calldata x 16 + 32 B log data x 8 = 768 per post, plus the L1 data fee on L2s |
| ours-lite | about 25k per batch, any N | Estimate: ours minus the storage slot (about 22k) |
| ours | about 47k per batch, any N; per post about 47k / N (N = 100: about 470) | Estimate: 21,000 intrinsic + about 1.5k calldata + 22,100 new storage slot (20,000 + 2,100 cold) + about 2k LOG3 + dispatch |

The per-post constant of B2 ignores ABI overhead and memory expansion, which grows quadratically with the number of 32-byte words (EVM memory cost is 3 x words + words^2 / 512). At N = 1000 that adds about 5k gas per batch (Estimate: 3 x 1000 + 1000^2 / 512 = 4,953). The benchmark captures it.

**Crossovers (Estimate, gas only, L1 pricing, all to be confirmed by measurement):**

- **ours vs B1.** At N = 1 ours costs more than B1 (about 47k vs about 25k): that is the price of on-chain idempotency and contract readability. At N = 2 ours is about 23.5k per post, within a few hundred gas of B1, and it is cheaper from there on. The benchmark decides whether the crossover is N = 2 or N = 3.
- **ours vs B2.** Ours wins on gas only when 47k / N < 21k / N + 770, that is 26k / N < 770, so N > 33.8: from about N >= 34.
- **ours-lite vs B2.** 25k / N < 21k / N + 770 gives 4k / N < 770, so N > 5.2: equal at about N = 5, cheaper from N >= 6.
- **On the L2s** the L1 data fee is charged per byte of (compressed) transaction data, so constant-size calldata wins sooner than on L1. The exact crossover comes from the benchmark.

Stated openly: **for small batches on L1, a plain hash list (B2) is cheaper than a Merkle root.** Merkle is chosen for constant on-chain size at any N and for contract-level inclusion proofs (ADR-005), not because it is always cheaper. ADR-005 states the revisit criterion.

**Money.**

- Gas is measured on the testnets (real executions). Price is taken from mainnet on a stated date, because testnet fees are not representative.
- Ethereum: gasUsed x mainnet base fee at the snapshot (the priority fee is stated separately with the snapshot).
- L2s: L2 execution gas x L2 mainnet base fee, plus the L1 data fee obtained with read-only `eth_call` to mainnet oracles: the Base GasPriceOracle and the Arbitrum NodeInterface. Exact method names To verify (candidates to check: `getL1Fee(bytes)` on the GasPriceOracle; `gasEstimateL1Component` on NodeInterface). Base's current stack lineage is To verify (ADR-007), which may change the oracle.
- Storage is reported twice: inside the Turbo free tier and at list price (ADR-002). Since the free tier is a 10 MiB lifetime allowance per wallet and per subnet (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/), and every upload is signed by one platform key, **list price is the realistic figure at any scale**; the free-tier column only describes the first uploads.

**Process.**

- The gas benchmark runs in Foundry (`forge snapshot` and scripts in `contracts/bench`) with no backend dependency, so it can be produced first (Tier 1).
- Results are committed as dated JSON (`packages/bench/results/*.json`); tables and charts in the README and in [docs/efficiency.md](../efficiency.md) are generated from them.
- The live demo is not the efficiency proof (small batches, demo mode); the benchmark is.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Single headline metric ($ per post only) | Easy to communicate | Hides latency and on-chain footprint; depends on volatile prices | Hides the trade-off that drives batching |
| Gas only | Deterministic, easy to reproduce | Ignores storage, which dominates the cost per post with an image; ignores the L1 data fee on L2s | Misleading on L2s and for image posts |
| Synthetic estimates without measurement | Fast | Unverifiable; easy to bias in our favour | Not acceptable for an evaluation of efficiency |
| Compare only against B0 and B1 | Makes our design look very good | Straw men: anyone batching would beat them | B2 and ours-lite are the honest rivals and are included |

## Consequences

Positive:

- Every efficiency claim in the README traces to a dated JSON result or to a labelled Estimate.
- The benchmark can show that our design loses in some regimes (small N on L1 vs B2, N = 1 vs B1), which makes the regimes where it wins credible.

Negative:

- Five contract variants and three chains to maintain in the benchmark.
- Money figures depend on a snapshot date and age quickly.

Follow-ups:

- Implement `contracts/bench` (B0, B1, B2, ours-lite) and the scripts in `packages/bench`.
- Confirm the L1 data fee oracle methods on Base and Arbitrum mainnet.
- Replace every Estimate in this ADR, ADR-005, ADR-006 and docs/efficiency.md with measured values.

## Evidence

- Benchmark results: pending (`packages/bench/results/`).
- Turbo list price: USD 73.51 per GiB, `winc` 14986793268274 from https://turbo.ardrive.io/v1/rates; the unit is inferred to be 1 GiB because https://turbo.ardrive.io/v1/price/bytes/1073741824 returned the same `winc` (Verified 2026-11-06). About USD 0.00007 per KiB (Estimate: 73.51 / 1,048,576).
- Turbo free tier: items up to 105 KiB, 10 MiB lifetime allowance tracked per wallet and per subnet (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/). The research notes of 2026-11-06 recorded "under 100 KiB" from a page that now returns 404; see ADR-002.
- To verify: L1 data fee oracle method names on Base and Arbitrum mainnet; Base stack lineage (ADR-007).
