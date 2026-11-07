# @phi/bench

Benchmark scripts. Each one writes dated results to `results/*.json`; the tables in the README and in [docs/efficiency.md](../../docs/efficiency.md) are taken from those files (ADR-001).

Requirements: Foundry (anvil, forge, cast) and Node 20 or later. No dependencies to install, no backend.

## Scripts

| Command | What it does | Output |
| ------- | ------------ | ------ |
| `node src/gas-bench.mjs` (or `pnpm bench` from the root) | Starts a local anvil node with Ethereum mainnet rules (Prague), deploys `PostAnchor` and the baselines B0, B1, B2, ours-lite, sends real transactions for N = 1, 10, 100, 500, 1000 and reads `gasUsed` from the receipts. Finds the crossovers with B2 by probing real transactions. Values are deterministic, so reruns reproduce the same numbers. | `results/<date>-gas-local-prague.json` |
| `node src/calldata-floor-probe.mjs` | Calls `eth_estimateGas` on six public chains (the three testnets and their mainnets) for 0 bytes, 1,000 non-zero bytes and 1,000 zero bytes of calldata, to see which calldata pricing each chain applies. | `results/<date>-calldata-floor-probe.json` |

## Not implemented yet

- Money conversion: mainnet price snapshot and the L1 data fee read from mainnet oracles on Base and Arbitrum (method names To verify, ADR-001).
- Arbitrum execution gas, which differs because Arbitrum applies no EIP-7623 calldata floor.
- Storage cost inside the Turbo free tier and at list price (ADR-002).
- Latency per stage (Accepted, Published, Settled) as p50 / p95, once the pipeline exists (Tier 2).
