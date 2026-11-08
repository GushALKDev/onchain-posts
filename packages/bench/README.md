# @onchain-posts/bench

Benchmark scripts. Each one writes dated results to `results/*.json`; the tables in the README and in [docs/efficiency.md](../../docs/efficiency.md) are taken from those files (ADR-001).

Requirements: Foundry (anvil, forge, cast) and Node 20 or later. No dependencies to install, no backend.

## Scripts

| Command | What it does | Output |
| ------- | ------------ | ------ |
| `node src/gas-bench.mjs` (or `pnpm bench` from the root) | Starts a local anvil node with Ethereum mainnet rules (Prague), deploys `PostAnchor` and the baselines B0, B1, B2, ours-lite, sends real transactions for N = 1, 10, 100, 500, 1000 and reads `gasUsed` from the receipts. Finds the crossovers with B2 by probing real transactions. Values are deterministic, so reruns reproduce the same numbers. | `results/<date>-gas-local-prague.json` |
| `node src/gas-bench.mjs --hardfork cancun` | Same benchmark without the EIP-7623 calldata floor: the proxy for Arbitrum execution gas. | `results/<date>-gas-local-cancun.json` |
| `node src/calldata-floor-probe.mjs` | Calls `eth_estimateGas` on six public chains (the three testnets and their mainnets) for 0 bytes, 1,000 non-zero bytes and 1,000 zero bytes of calldata, to see which calldata pricing each chain applies. | `results/<date>-calldata-floor-probe.json` |
| `node src/cost-snapshot.mjs` | Converts the two gas files into USD per post with a live mainnet snapshot: Chainlink ETH/USD, base fees, Base `GasPriceOracle.getL1Fee`, Arbitrum `NodeInterface.gasEstimateL1Component`, Turbo list price. Live prices, so values change between runs. | `results/<date>-cost-snapshot.json` |

## Not implemented yet

- Latency per stage (Accepted, Published, Settled) as p50 / p95, once the pipeline exists (Tier 2).
