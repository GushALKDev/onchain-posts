# contracts

Foundry project for the on-chain part of the design.

Not implemented yet. The design of `PostAnchor` lives in [ADR-009](../docs/decisions/ADR-009-anchor-contract.md) as a documentation snippet, not as source code.

## Layout

| Folder    | Purpose |
| --------- | ------- |
| `src/`    | `PostAnchor`: one transaction per batch and chain anchors a Merkle root with one storage slot (ADR-004, ADR-009). |
| `test/`   | Unit, fuzz and invariant tests for the invariants I1 to I6 listed in ADR-009. |
| `bench/`  | Gas baselines from ADR-001: B0 (naive storage, one tx per post), B1 (one event per post), B2 (one event per batch with the N post hashes), ours-lite (root in an event, no storage). These contracts exist only to be measured and are never deployed as product. |
| `script/` | Deployment through CREATE2 so the address is the same on Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia. |

The gas benchmark runs with Foundry only (`forge snapshot` and scripts in `bench/`) and has no dependency on the backend (ADR-001).
