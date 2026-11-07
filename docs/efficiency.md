# Efficiency

How efficiency is defined, measured and reported. The decisions behind this page are [ADR-001](decisions/ADR-001-efficiency-definition.md) (definition and method) and [ADR-006](decisions/ADR-006-batching-policy.md) (batching).

Status: method fixed, **results pending**. Every number on this page is labelled Verified, Estimate, To verify or Illustrative; limits and defaults we choose are marked "(design parameter)".

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

- Gas is measured on the testnets; price is taken from **mainnet on a stated date** (testnet fees are not representative).
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

Pending: filled from `packages/bench/results/*.json`. Placeholder layout, one table per chain.

**Gas per post (Ethereum Sepolia, same layout for Base Sepolia and Arbitrum Sepolia)**

| Variant | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------- | ----- | ------ | ------- | ------- | -------- |
| B0 | pending | pending | pending | pending | pending |
| B1 | pending | pending | pending | pending | pending |
| B2 | pending | pending | pending | pending | pending |
| ours-lite | pending | pending | pending | pending | pending |
| ours | pending | pending | pending | pending | pending |

**End-to-end cost per post (USD, list-price storage, one chain)**: same rows and columns, pending.

**On-chain bytes per post**: same rows and columns, pending.

## Crossovers

Estimates from ADR-001, gas only, L1 pricing. They illustrate the shape; the benchmark produces the real numbers.

| Comparison | Per-post gas | Crossover |
| ---------- | ------------ | --------- |
| ours vs B1 | 47k / N vs about 25k | ours is more expensive at N = 1; about equal at N = 2; cheaper from N = 2 or 3 |
| ours vs B2 | 47k / N vs 21k / N + 770 | 26k / N < 770 gives N > 33.8: ours cheaper from N >= 34 |
| ours-lite vs B2 | 25k / N vs 21k / N + 770 | 4k / N < 770 gives N > 5.2: ours-lite cheaper from N >= 6 |

On the L2s the L1 data fee is charged per byte of transaction data, so constant-size calldata (ours, ours-lite) wins sooner than on L1; the exact L2 crossovers come from the benchmark.

Stated openly: **for small batches on L1 a plain hash list (B2) is cheaper than a Merkle root.** Merkle is chosen for constant size and contract-level inclusion proofs; ADR-005 states when to revisit.

## Batching parameters

| Chain | Tmax | Nmax |
| ----- | ---- | ---- |
| Base Sepolia | 30 s | 500 |
| Arbitrum Sepolia | 30 s | 500 |
| Ethereum Sepolia | 300 s | 500 |

All design parameters (ADR-006). `DEMO_MODE` uses a short Tmax (for example 5 s) or a protected "flush now" endpoint: **demo mode is not the efficiency configuration**, and the live demo is not the efficiency proof; the benchmark is.

## Limitations

- Gas Estimates ignore ABI overhead details; B2 also pays EVM memory expansion, which grows quadratically with the number of 32-byte words (about 5k gas at N = 1000, Estimate: 3 x 1000 + 1000^2 / 512).
- Money figures depend on the snapshot date and age quickly; the L1 data fee varies with L1 blob and calldata prices.
- Testnet gas is real execution, but testnet inclusion latency may not match mainnet.
- Storage price is dynamic (Turbo rates are recorded per run).
- Latency of the live demo uses demo-mode batching and is not representative.

## How to reproduce

Placeholder. The gas part runs with Foundry only (`forge snapshot` and scripts in `contracts/bench`), with no backend dependency. Money conversion and latency use `packages/bench` and write dated `results/*.json`.
