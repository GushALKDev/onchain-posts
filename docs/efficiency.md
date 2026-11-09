# Efficiency

How efficiency is defined, measured and reported. The decisions behind this page are [ADR-001](decisions/ADR-001-efficiency-definition.md) (definition and method) and [ADR-006](decisions/ADR-006-batching-policy.md) (batching).

Status: gas and USD cost measured on 2026-11-07 (gas with real transactions, prices from a mainnet snapshot); latency per stage not measured in this delivery. Every number on this page is labelled Verified, Estimate, To verify or Illustrative; limits and defaults we choose are marked "(design parameter)".

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
- Ethereum: gasUsed (Prague rules) x (base fee + suggested priority fee) at the snapshot.
- Base: gasUsed (Prague rules, same calldata floor as Ethereum) x (L2 base fee + suggested priority fee) + the L1 data fee from `GasPriceOracle.getL1Fee(bytes)` at `0x420000000000000000000000000000000000000F`, called with the unsigned EIP-1559 transaction.
- Arbitrum: (gasUsed under cancun rules, which have no calldata floor, + the L1 component from `NodeInterface.gasEstimateL1Component(address,bool,bytes)` at `0x00000000000000000000000000000000000000C8`) x L2 base fee.
- ETH/USD from the Chainlink ETH / USD feed on Ethereum mainnet (`0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`, `description()` returns "ETH / USD").
- Both oracle methods were confirmed by successful `eth_call`s on mainnet on 2026-11-07 (they were To verify in ADR-001); the Base oracle reports version 1.6.0 with Fjord and Isthmus active.
- Each results file records the snapshot date, block numbers and prices used.

## Storage cost

Turbo list price at the 2026-11-07 snapshot: USD 71.41 per GiB, plus a flat fee per data item of 6,275,347 winc (USD 0.0000308), read from https://turbo.ardrive.io/v1/rates by `cost-snapshot.mjs`. The price of a 95 KiB item from `/v1/price/bytes/97280` matches the computed value, fee included. (ADR-002 recorded USD 73.51 per GiB on 2026-11-06: the price moves daily.)

| Item | Size | List price per post (2026-11-07) |
| ---- | ---- | -------------------------------- |
| Image | 95 KiB maximum (design parameter, ADR-003) | USD 0.00650 |
| Post JSON | 1,400 B (Estimate: ADR-014 fields, about 400 B, plus a 1,000-byte caption) | USD 0.000124 |
| Manifest share, per chain | 209 B per entry + 150 B header (Estimates, ADR-006) | USD 0.0000546 at N = 1, 0.0000143 at N = 100, 0.0000139 at N = 1000 |

Reported twice, as ADR-001 requires:

- **Subsidised**: Turbo's free tier covers items up to 105 KiB, but only within a 10 MiB lifetime allowance per wallet and per subnet (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/). With one platform key that is about 107 images in total (Estimate: 10,240 KiB / 95 KiB).
- **List price**: the figure for production; the free tier covers the PoC.

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

**Base and Arbitrum execution gas.** Base applies the same EIP-7623 calldata floor as Ethereum, so the table above is Base's execution gas too. Arbitrum applies no floor, so its execution gas comes from the same benchmark under cancun rules ([`2026-11-07-gas-local-cancun.json`](../packages/bench/results/2026-11-07-gas-local-cancun.json), `node packages/bench/src/gas-bench.mjs --hardfork cancun`): B2 costs 3,130, 1,008 and 798 gas per post at N = 10, 100 and 1000; every other variant is unchanged. Cross-check with `eth_estimateGas` and a state override that places the contract code at a test address (2026-11-07): `anchor` estimates 47,454 on Ethereum mainnet, Base and Arbitrum One (L2 part), and B2 with N = 100 estimates 150,766 on Ethereum and Base but 101,950 on Arbitrum One (L2 part), against 149,470 and 100,833 measured locally. The differences are the clients' estimation margin, under 1.1%.

### USD per post

Source: [`packages/bench/results/2026-11-07-cost-snapshot.json`](../packages/bench/results/2026-11-07-cost-snapshot.json), produced by `node packages/bench/src/cost-snapshot.mjs`. Snapshot of 2026-11-07, about 17:51 UTC: ETH/USD 2,233.09 (Chainlink); base fee 0.0637 gwei on Ethereum (block 26,364,588), 0.005 gwei on Base (block 54,417,631), 0.0201 gwei on Arbitrum One (block 522,149,300). Anchoring cost only, shown per 1,000 posts because the per-post values are tiny:

**Ethereum: USD per 1,000 posts**

| Variant | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------- | ----- | ------ | ------- | ------- | -------- |
| B0, caption 100 B | 25.8 | 25.8 | 25.8 | 25.8 | 25.8 |
| B0, caption 1,000 B | 116.3 | 116.3 | 116.3 | 116.3 | 116.3 |
| B1 | 3.26 | 3.26 | 3.26 | 3.26 | 3.26 |
| B2 | 3.46 | 0.493 | 0.213 | 0.188 | 0.185 |
| ours-lite | 3.50 | 0.350 | 0.0350 | 0.00701 | 0.00350 |
| ours | 6.69 | 0.669 | 0.0669 | 0.0134 | 0.00670 |

**Base: USD per 1,000 posts**

| Variant | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------- | ----- | ------ | ------- | ------- | -------- |
| B0, caption 100 B | 2.44 | 2.44 | 2.44 | 2.44 | 2.44 |
| B0, caption 1,000 B | 11.0 | 11.0 | 11.0 | 11.0 | 11.0 |
| B1 | 0.308 | 0.308 | 0.308 | 0.308 | 0.308 |
| B2 | 0.327 | 0.0468 | 0.0203 | 0.0180 | 0.0177 |
| ours-lite | 0.331 | 0.0331 | 0.00331 | 0.000663 | 0.000331 |
| ours | 0.632 | 0.0632 | 0.00632 | 0.00126 | 0.000632 |

**Arbitrum One: USD per 1,000 posts**

| Variant | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------- | ----- | ------ | ------- | ------- | -------- |
| B0, caption 100 B | 8.16 | 8.16 | 8.16 | 8.16 | 8.16 |
| B0, caption 1,000 B | 36.7 | 36.7 | 36.7 | 36.7 | 36.7 |
| B1 | 1.04 | 1.04 | 1.04 | 1.04 | 1.04 |
| B2 | 1.11 | 0.143 | 0.0473 | 0.0387 | 0.0377 |
| ours-lite | 1.12 | 0.112 | 0.0112 | 0.00224 | 0.00112 |
| ours | 2.12 | 0.212 | 0.0212 | 0.00425 | 0.00212 |

On the L2s the L1 data fee is a small share at this snapshot: for one `anchor` transaction it is 550,508,995 wei on Base (about USD 0.0000012, against about USD 0.00063 of L2 execution) and 327 L2 gas on Arbitrum (against 47,058 of execution).

**End-to-end USD per post with a 95 KiB image, anchored with ours**

| Chains | N = 1 | N = 10 | N = 100 | N = 500 | N = 1000 |
| ------ | ----- | ------ | ------- | ------- | -------- |
| Ethereum only | 0.0134 | 0.0073 | 0.0067 | 0.0067 | 0.0066 |
| Base only | 0.0073 | 0.0067 | 0.0066 | 0.0066 | 0.0066 |
| Arbitrum only | 0.0088 | 0.0069 | 0.0067 | 0.0066 | 0.0066 |
| All three | 0.0162 | 0.0076 | 0.0068 | 0.0067 | 0.0067 |

**The storage of the image is 96% or more of the end-to-end cost from N = 100 on** (USD 0.0065 of USD 0.0068 with all three chains at N = 100; percentages from the same results file). Anchoring on all three chains costs under USD 0.0001 per post at N = 100. Consequences: at this snapshot, batching matters most on Ethereum and at small N; beyond N = 100 the design choices that move the cost are the image cap (ADR-003) and the storage price, not Merkle versus hash list. With the Turbo free tier (items up to 105 KiB within a 10 MiB lifetime allowance per wallet, ADR-002) the PoC pays no storage at all.

## Crossovers

Measured under Ethereum mainnet rules (same results file, `crossovers`; B2 probed with real transactions around the crossover).

| Comparison | Crossover (measured) | Detail | Estimate before measuring |
| ---------- | -------------------- | ------ | ------------------------- |
| ours vs B1 | N >= 3 | 47,058 / 2 = 23,529 is above 22,922 | N = 2 or 3 |
| ours-lite vs B1 | N >= 2 | 24,629 / 2 = 12,315 | not estimated |
| ours vs B2 | N >= 20 | B2 per batch 46,060 at N = 19 and 47,370 at N = 20, vs 47,058 | N >= 34 |
| ours-lite vs B2 | N >= 2 | B2 per batch 24,342 at N = 1 and 25,116 at N = 2, vs 24,629 | N >= 6 |

Why the B2 crossover moved from 34 to 20: from N = 10 on, B2's gas equals the EIP-7623 calldata floor exactly (21,000 + 10 x tokens), about 1,280 gas per post instead of the 770 estimated from standard calldata pricing. On Base the same floor applies and the per-byte L1 data fee comes on top, so constant-size calldata wins at least as early. On Arbitrum there is no floor: under cancun rules ours beats B2 from **N >= 31** (B2 per batch 46,718 at N = 30 and 47,528 at N = 31, vs 47,058); the L1 component grows by about 43 L2 gas per post for B2 and stays at 327 per batch for ours, which moves that crossover slightly earlier.

Stated openly: **below 20 posts per batch on L1 a plain hash list (B2) is cheaper than our Merkle root with a storage slot.** Merkle with a slot is chosen for constant size, on-chain idempotency and contract-level inclusion proofs; ADR-005 states when to revisit.

## Batching parameters

| Chain | Tmax | Nmax |
| ----- | ---- | ---- |
| Base Sepolia | 30 s | 500 |
| Arbitrum Sepolia | 30 s | 500 |
| Ethereum Sepolia | 300 s | 500 |

All design parameters (ADR-006). `DEMO_MODE` uses a short Tmax (for example 5 s) or a protected "flush now" endpoint: **demo mode is not the efficiency configuration**, and the live demo is not the efficiency proof; the benchmark is.

## Limitations

- Gas is measured on local nodes (Prague rules for Ethereum and Base, cancun rules as the Arbitrum proxy) and cross-checked on mainnet with `eth_estimateGas`, not on deployed contracts.
- B0 and B1 are measured on 10 sampled posts each (one transaction per post, constant cost); roots and hashes are deterministic pseudo-random 32-byte values, which do not change gas.
- The post JSON size and manifest entry size used for storage cost are Estimates.
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

```bash
node packages/bench/src/gas-bench.mjs --hardfork cancun   # Arbitrum execution-gas proxy -> results/<date>-gas-local-cancun.json
node packages/bench/src/cost-snapshot.mjs                 # USD per post from a mainnet price snapshot -> results/<date>-cost-snapshot.json
```

The cost snapshot reads live prices, so a rerun on another day gives other USD values; the gas files are deterministic. Latency per stage (p50 / p95) is not measured in this delivery; the backend records the timestamps of every stage per post and chain, so it can be added to `packages/bench` from real anchors.
