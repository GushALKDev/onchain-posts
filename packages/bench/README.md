# @phi/bench

Benchmark scripts. They write dated results to `results/*.json`; README and docs tables and charts are generated from those files (ADR-001, [docs/efficiency.md](../../docs/efficiency.md)).

Not implemented yet.

## Responsibilities

- Read gas figures produced by Foundry in `contracts/bench` (B0, B1, B2, ours-lite, ours) for N = 1, 10, 100, 500, 1000 per chain.
- Measure gas on the three testnets and convert to money with a mainnet price snapshot taken on a stated date; for the L2s, read the L1 data fee with read-only `eth_call` to mainnet oracles (method names To verify, ADR-001).
- Report storage cost twice: inside the Turbo free tier and at list price (ADR-002).
- Record latency per stage (Accepted, Published, Settled) as p50 / p95.
