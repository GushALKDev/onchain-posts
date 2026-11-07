# Efficiency

How efficiency is defined, measured and reported. The decisions behind this page are [ADR-001](decisions/ADR-001-efficiency-definition.md) (definition and method) and [ADR-006](decisions/ADR-006-batching-policy.md) (batching).

Status: gas measured under Ethereum mainnet rules (2026-11-07); money conversion and L2-specific measurements pending. Every number on this page is labelled Verified, Estimate, To verify or Illustrative; limits and defaults we choose are marked "(design parameter)".

## Metrics

Reported separately, never collapsed into one number:

| Metric | Unit | Definition |
| ------ | ---- | ---------- |
| End-to-end cost per post | USD | Storage (image + post JSON + share of the manifest) + anchoring x number of chains chosen |
| On-chain bytes per post | bytes | Calldata and log data attributable to one post |
| Gas per batch and per post | gas | Per post = per batch / N |
| Latency per stage | seconds, p50 / p95 | See Latency stages |

## Scenarios

Batch sizes N = 1, 10, 100, 500, 1000 (design parameters), on each of Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia.

## Baselines

They live only in `contracts/bench` and are never deployed as product.

| ID | Design | What it measures |
| -- | ------ | ---------------- |
| B0 | Stores username, caption and imageHash in storage, one tx per post per chain | The cost of putting content on-chain |
| B1 | One tx per post per chain, postHash in an event | The cost of not batching |
| B2 | One tx per batch per chain, the N postHashes in an event (hash list, no tree) | The non-Merkle rival with the same batching |
| ours-lite | One tx per batch, root in an event, no storage slot | The price of on-chain idempotency and contract readability |
| ours | One tx per batch, root + one storage slot (ADR-009) | The chosen design |

## Money method

- Gas is measured with real transactions under **mainnet rules**: a local anvil node with the Prague hardfork, which the calldata probe shows matches Ethereum mainnet. Ethereum Sepolia currently prices gas differently from mainnet, so it is not the gas reference ([ADR-001](decisions/ADR-001-efficiency-definition.md)). Price is taken from **mainnet on a stated date** (testnet fees are not representative).
- Ethereum: gasUsed x mainnet base fee at the snapshot (priority fee stated separately).
- L2s: L2 execution cost at the mainnet L2 base fee, plus the **L1 data fee read with `eth_call` from mainnet oracles** (Base GasPriceOracle, Arbitrum NodeInterface; exact method names To verify, ADR-001).
- Each results file records the snapshot date, block numbers and prices used.

## Storage cost

| Item | Size | List price (Estimate) |
| ---- | ---- | --------------------- |
| Image | at most 95 KiB (design parameter, ADR-003) | at most about USD 0.0067 (95 x 0.0000701) |
| Post JSON | about 0.5 to 1 KiB (Estimate: fields of ADR-014 with a caption up to 1,000 code points) | under USD 0.0001 |
| Manifest share | about 209 B per entry (Estimate, ADR-006) | about USD 0.000014 per post per chain |

List price: USD 73.51 per GiB, about USD 0.0000701 per KiB (Verified 2026-11-06 / Estimate, ADR-002).

Reported twice, as ADR-001 requires:

- **Subsidised**: Turbo's free tier covers items up to 105 KiB, but only within a 10 MiB lifetime allowance per wallet and per subnet (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/). With one platform key that is about 107 images in total (Estimate: 10,240 KiB / 95 KiB).
- **List price**: the realistic figure for the platform at any scale.

## Latency stages

| Stage | Starts | Ends | Expected driver |
| ----- | ------ | ---- | --------------- |
| Accepted | Request received | Signed receipt returned | Validation and signing (CPU) |
| Stored | Receipt issued | Image and post JSON readable through Turbo | Turbo upload |
| Published | Post queued | Anchoring tx included (soft) | Tmax or Nmax, then inclusion |
| Settled | Tx included | Chain's safe head covers the tx | L2 batch posting to L1, or L1 justification (ADR-017) |

Reported as p50 and p95 per chain. The receipt's `anchorBy` is measured against Published, not Settled (ADR-015).

## Results

Source: [`packages/bench/results/2026-11-07-gas-local-prague.json`](../packages/bench/results/2026-11-07-gas-local-prague.json), produced by `node packages/bench/src/gas-bench.mjs`.

**Gas per post, Ethereum mainnet rules (measured 2026-11-07)**

| Variant | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------- | ----- | ------ | ------- | ------- | -------- |
| B0, caption 100 B | 181,675 | 181,675 | 181,675 | 181,675 | 181,675 |
| B0, caption 1,000 B | 817,418 | 817,418 | 817,418 | 817,418 | 817,418 |
| B1 | 22,922 | 22,922 | 22,922 | 22,922 | 22,922 |
| B2 | 24,342 | 3,463 | 1,495 | 1,320 | 1,298 |
| ours-lite | 24,629 | 2,463 | 246 | 49 | 25 |
| ours | 47,058 | 4,706 | 471 | 94 | 47 |

**On-chain bytes per post (calldata + log data, measured)**

| Variant | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------- | ----- | ------ | ------- | ------- | -------- |
| B0, caption 100 B | 356 | 356 | 356 | 356 | 356 |
| B0, caption 1,000 B | 1,252 | 1,252 | 1,252 | 1,252 | 1,252 |
| B1 | 36 | 36 | 36 | 36 | 36 |
| B2 | 196 | 77 | 65 | 64 | 64 |
| ours-lite | 164 | 16 | 2 | 0.3 | 0.2 |
| ours | 164 | 16 | 2 | 0.3 | 0.2 |

B0 also writes 7 storage words per post with a 100-byte caption and 35 with a 1,000-byte caption (Estimate from the Solidity string layout: 1 word for imageHash, 1 for the short username, 1 + ceil(bytes / 32) for the caption); ours writes one storage word per batch. ours-lite and ours send the same bytes (100 B calldata, 64 B log data per batch): they differ only in the storage slot (22,432 gas per batch, measured).

**Base and Arbitrum.** Base applies the same EIP-7623 calldata floor to execution gas, so the table above is a close proxy for Base execution gas; the L1 data fee comes on top and is pending. Arbitrum applies no floor, so B2 is cheaper there per post than in this table; Arbitrum execution gas and its L1 component are pending.

**End-to-end cost per post (USD)**: pending (needs the mainnet price snapshot and the L1 data fee oracles).

## Crossovers

Measured under Ethereum mainnet rules (same results file, `crossovers`; B2 probed with real transactions around the crossover).

| Comparison | Crossover (measured) | Detail | Estimate before measuring |
| ---------- | -------------------- | ------ | ------------------------- |
| ours vs B1 | N >= 3 | 47,058 / 2 = 23,529 is above 22,922 | N = 2 or 3 |
| ours-lite vs B1 | N >= 2 | 24,629 / 2 = 12,315 | not estimated |
| ours vs B2 | N >= 20 | B2 per batch 46,060 at N = 19 and 47,370 at N = 20, vs 47,058 | N >= 34 |
| ours-lite vs B2 | N >= 2 | B2 per batch 24,342 at N = 1 and 25,116 at N = 2, vs 24,629 | N >= 6 |

Why the B2 crossover moved from 34 to 20: from N = 10 on, B2's gas equals the EIP-7623 calldata floor exactly (21,000 + 10 x tokens), about 1,280 gas per post instead of the 770 estimated from standard calldata pricing. On Base the same floor applies and the per-byte L1 data fee comes on top, so constant-size calldata wins at least as early; on Arbitrum there is no floor, so its crossover will be later than on L1 before the L1 component (to be measured).

Stated openly: **below 20 posts per batch on L1 a plain hash list (B2) is cheaper than our Merkle root with a storage slot.** Merkle with a slot is chosen for constant size, on-chain idempotency and contract-level inclusion proofs; ADR-005 states when to revisit.

## Batching parameters

| Chain | Tmax | Nmax |
| ----- | ---- | ---- |
| Base Sepolia | 30 s | 500 |
| Arbitrum Sepolia | 30 s | 500 |
| Ethereum Sepolia | 300 s | 500 |

All design parameters (ADR-006). `DEMO_MODE` uses a short Tmax (for example 5 s) or a protected "flush now" endpoint: **demo mode is not the efficiency configuration**, and the live demo is not the efficiency proof; the benchmark is.

## Limitations

- Gas is measured under Ethereum mainnet rules only; Base execution gas follows the same calldata floor, Arbitrum's does not, and neither L2's L1 data fee is included yet.
- B0 and B1 are measured on 10 sampled posts each (one transaction per post, constant cost); roots and hashes are random 32-byte values, which do not change gas.
- Money figures depend on the snapshot date and age quickly; the L1 data fee varies with L1 blob and calldata prices.
- Testnet gas is real execution, but testnet inclusion latency may not match mainnet.
- Storage price is dynamic (Turbo rates are recorded per run).
- Latency of the live demo uses demo-mode batching and is not representative.

## How to reproduce

Requirements: Foundry (anvil, forge, cast) and Node 20 or later; no backend.

```bash
node packages/bench/src/gas-bench.mjs             # gas per variant and N, crossovers -> results/<date>-gas-local-prague.json
node packages/bench/src/calldata-floor-probe.mjs  # calldata pricing on the six public chains -> results/<date>-calldata-floor-probe.json
cd contracts && forge test                        # includes verifyPost gas for a 500-leaf tree -> snapshots/PostAnchor.json
```

Money conversion and latency will be added to `packages/bench` and write dated `results/*.json` the same way.
