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

**Estimates, written before measuring and kept for comparison.** All gas figures in this table are Estimates at L1 pricing; the measured values follow below.

| Variant | Gas | Derivation |
| ------- | --- | ---------- |
| B0 | about 100k to 200k per post with a short caption | Estimate: 21,000 intrinsic + a few new storage words at 22,100 each (20,000 SSTORE + 2,100 cold) for username, caption, imageHash and string length words |
| B0, 1,000-byte caption | about 730k for the caption alone | Estimate: ceil(1000 / 32) = 32 data words + 1 length word = 33 x 22,100 |
| B1 | about 25k per post | Estimate: 21,000 intrinsic + about 0.6k calldata (36 B) + about 1.4k LOG + dispatch |
| B2 | about 21k per tx + about 770 per post | Estimate: 32 B calldata x 16 + 32 B log data x 8 = 768 per post, plus the L1 data fee on L2s |
| ours-lite | about 25k per batch, any N | Estimate: ours minus the storage slot (about 22k) |
| ours | about 47k per batch, any N; per post about 47k / N (N = 100: about 470) | Estimate: 21,000 intrinsic + about 1.5k calldata + 22,100 new storage slot (20,000 + 2,100 cold) + about 2k LOG3 + dispatch |

The per-post constant of B2 in that table ignores ABI overhead and memory expansion (EVM memory cost is 3 x words + words^2 / 512), and, as the measurement showed, the EIP-7623 calldata floor.

**Measured (2026-11-07).** Command: `node packages/bench/src/gas-bench.mjs`; results: [`packages/bench/results/2026-11-07-gas-local-prague.json`](../../packages/bench/results/2026-11-07-gas-local-prague.json). Real transactions on a local anvil node with Ethereum mainnet rules (Prague hardfork), `gasUsed` read from the receipts; the L1 data fee that L2s add is not included. Gas per post:

| Variant | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------- | ----- | ------ | ------- | ------- | -------- |
| B0, caption 100 B | 181,675 | 181,675 | 181,675 | 181,675 | 181,675 |
| B0, caption 1,000 B | 817,418 | 817,418 | 817,418 | 817,418 | 817,418 |
| B1 | 22,922 | 22,922 | 22,922 | 22,922 | 22,922 |
| B2 | 24,342 | 3,463 | 1,495 | 1,320 | 1,298 |
| ours-lite | 24,629 | 2,463 | 246 | 49 | 25 |
| ours | 47,058 | 4,706 | 471 | 94 | 47 |

What the measurement changed:

- ours (47,058 gas per batch) and ours-lite (24,629) match their Estimates within 1%. B1 is 22,922, below its Estimate of about 25k.
- **B2 costs about 1,280 gas per post at scale, not 770.** From N = 10 on, B2's `gasUsed` equals the EIP-7623 calldata floor exactly: 21,000 + 10 x tokens, with tokens = zero bytes + 4 x non-zero bytes. At N = 1000: 32,068 calldata bytes, 189 of them zero, 127,705 tokens, 1,298,050 gas, identical to the receipt. The floor applies because B2's calldata is large relative to its execution; ours and ours-lite send 100 bytes and stay execution-priced.

**Crossovers (measured, gas only, mainnet L1 rules; `crossovers` in the same results file, B2 probed with real transactions):**

| Comparison | Crossover | Detail | Estimate before measuring |
| ---------- | --------- | ------ | ------------------------- |
| ours vs B1 | N >= 3 | 47,058 / 2 = 23,529 is still above 22,922 | N = 2 or 3 |
| ours-lite vs B1 | N >= 2 | 24,629 / 2 = 12,315 | not estimated |
| ours vs B2 | **N >= 20** | B2 per batch: 46,060 at N = 19, 47,370 at N = 20; ours: 47,058 | N >= 34 |
| ours-lite vs B2 | N >= 2 | B2 per batch: 24,342 at N = 1, 25,116 at N = 2; ours-lite: 24,629 | N >= 6 |
| Price of the storage slot | 22,432 gas per batch | ours minus ours-lite | about 22k |

Stated openly: **for batches below 20 posts on L1, a plain hash list (B2) is cheaper than our Merkle root with a storage slot**, and ours-lite is cheaper than both from N = 2. Merkle with a slot is chosen for constant on-chain size at any N, on-chain idempotency and contract-level inclusion proofs (ADR-005, ADR-009), not because it is always cheaper. ADR-005 states the revisit criterion.

**Calldata pricing differs per chain.** Command: `node packages/bench/src/calldata-floor-probe.mjs`; results: [`packages/bench/results/2026-11-07-calldata-floor-probe.json`](../../packages/bench/results/2026-11-07-calldata-floor-probe.json). `eth_estimateGas` of a plain transfer carrying 0 bytes, 1,000 non-zero bytes and 1,000 zero bytes:

| Chain | Empty | 1,000 non-zero | 1,000 zero | Reading |
| ----- | ----- | -------------- | ---------- | ------- |
| Ethereum mainnet | 21,000 | 61,825 | 31,352 | Prague with the EIP-7623 floor (61,000 and 31,000, plus estimation padding): same rules as the local node |
| Base mainnet and Base Sepolia | 21,000 | 61,825 | 31,352 | Same floor on L2 execution gas |
| Arbitrum One | 21,353 | 37,657 | 25,633 | No floor (standard 37,000 and 25,000) plus Arbitrum's L1 component |
| Arbitrum Sepolia | 21,000 | 37,364 | 25,340 | Same as Arbitrum One |
| Ethereum Sepolia | 15,000 | 79,896 | 79,896 | A different schedule from mainnet: lower intrinsic gas, zero bytes priced like non-zero bytes. Which upgrade introduced it: To verify |

Consequences for the crossovers: on Base the floor applies to execution gas as on L1, and the per-byte L1 data fee comes on top, so constant-size calldata wins at least as early as on L1. On Arbitrum there is no floor, so B2's execution cost per post is closer to the original 770 Estimate and its crossover with ours will be later than on L1, before adding the L1 component: to be measured on Arbitrum.

**Money.**

- Gas is measured with real transactions under mainnet rules: for Ethereum, on a local node with the Prague hardfork, which the probe above shows matches mainnet. **Changed on 2026-11-07:** this ADR originally said "measured on the testnets", but Ethereum Sepolia currently prices gas differently from mainnet (probe above), so Sepolia gas would misstate mainnet cost. The testnets remain the place for inclusion latency and end-to-end runs (Tier 2). Price is taken from mainnet on a stated date, because testnet fees are not representative.
- Ethereum: gasUsed x mainnet base fee at the snapshot (the priority fee is stated separately with the snapshot).
- L2s: L2 execution gas x L2 mainnet base fee, plus the L1 data fee obtained with read-only `eth_call` to mainnet oracles: the Base GasPriceOracle and the Arbitrum NodeInterface. Exact method names To verify (candidates to check: `getL1Fee(bytes)` on the GasPriceOracle; `gasEstimateL1Component` on NodeInterface). Base's current stack lineage is To verify (ADR-007), which may change the oracle.
- Storage is reported twice: inside the Turbo free tier and at list price (ADR-002). Since the free tier is a 10 MiB lifetime allowance per wallet and per subnet (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/), and every upload is signed by one platform key, **list price is the realistic figure at any scale**; the free-tier column only describes the first uploads.

**Process.**

- The gas benchmark uses Foundry tools only (anvil, forge, cast; baselines in `contracts/bench`, runner in `packages/bench`) with no backend dependency, so it can be produced first (Tier 1).
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
- The benchmark shows where our design loses (N < 20 vs B2 on L1, N < 3 vs B1), which makes the regimes where it wins credible.

Negative:

- Five contract variants and three chains to maintain in the benchmark.
- Money figures depend on a snapshot date and age quickly.

Follow-ups:

- Confirm the L1 data fee oracle methods on Base and Arbitrum mainnet, and add the money conversion to `packages/bench`.
- Measure Arbitrum execution gas separately (no EIP-7623 floor there).
- Identify the gas schedule currently active on Ethereum Sepolia.

## Evidence

- Gas benchmark: [`packages/bench/results/2026-11-07-gas-local-prague.json`](../../packages/bench/results/2026-11-07-gas-local-prague.json), produced by `node packages/bench/src/gas-bench.mjs` (anvil 1.7.1, solc 0.8.30, evm_version cancun, Prague execution rules).
- Calldata pricing per chain: [`packages/bench/results/2026-11-07-calldata-floor-probe.json`](../../packages/bench/results/2026-11-07-calldata-floor-probe.json), produced by `node packages/bench/src/calldata-floor-probe.mjs`.
- EIP-7623 floor formula: confirmed by the exact match above (B2 at N = 10, 100 and 1000); specification at https://eips.ethereum.org/EIPS/eip-7623.
- Money conversion and L2 measurements (L1 data fee, Arbitrum execution gas): pending.
- Turbo list price: USD 73.51 per GiB, `winc` 14986793268274 from https://turbo.ardrive.io/v1/rates; the unit is inferred to be 1 GiB because https://turbo.ardrive.io/v1/price/bytes/1073741824 returned the same `winc` (Verified 2026-11-06). About USD 0.00007 per KiB (Estimate: 73.51 / 1,048,576).
- Turbo free tier: items up to 105 KiB, 10 MiB lifetime allowance tracked per wallet and per subnet (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/). The research notes of 2026-11-06 recorded "under 100 KiB" from a page that now returns 404; see ADR-002.
- To verify: L1 data fee oracle method names on Base and Arbitrum mainnet; Base stack lineage (ADR-007); which upgrade set Ethereum Sepolia's current gas schedule.
