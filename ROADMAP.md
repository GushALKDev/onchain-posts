# Roadmap

Living document: it is updated in the same commit as the work it describes. When an item is completed, tick it and link the evidence (test, results file, ADR update or commit).

Legend: `[x]` done, `[~]` in progress, `[ ]` pending.

Deadline: Friday 2026-11-13. Order of work follows the delivery priority in [README section 12](README.md#12-limitations-and-future-work).

## Status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| Block B | Documentation-first scaffold: repo, README, ADRs, efficiency and threat model, diagrams | Done (2026-11-07) |
| Tier 1 | The evidence and the reasoning: contract, invariant tests, benchmark, `packages/core`, verifier | In progress: contract, tests and gas benchmark done |
| Tier 2 | Minimal pipeline: backend, Postgres, Turbo uploads, anchoring on the 3 testnets | Not started |
| Tier 3 | Minimal web: compose, per-stage status, Verify page | Not started |

## Block B: documentation-first scaffold

- [x] pnpm workspaces monorepo, package skeletons (`core`, `backend`, `web`, `verifier`, `bench`) and Foundry skeleton
- [x] README skeleton (12 sections)
- [x] ADR template and ADR-001 to ADR-019 ([docs/decisions](docs/decisions/))
- [x] [docs/efficiency.md](docs/efficiency.md) and [docs/threat-model.md](docs/threat-model.md)
- [x] [config/trusted-keys.json](config/trusted-keys.json) schema with placeholder entries
- [x] Six Archify diagrams: architecture, publish flow, privacy, lifecycle, data model, verification ([docs/diagrams](docs/diagrams/))
- [x] Re-check of the research sources; stale facts corrected in the ADRs' Evidence sections (2026-11-07)

## Tier 1: the evidence and the reasoning

### Contract (`contracts/`)

- [x] `PostAnchor` as designed in [ADR-009](docs/decisions/ADR-009-anchor-contract.md); solc 0.8.30 and `evm_version = "cancun"` pinned ([contracts/src/PostAnchor.sol](contracts/src/PostAnchor.sol))
- [x] Unit tests for `anchor` and `verifyPost` ([contracts/test/PostAnchor.t.sol](contracts/test/PostAnchor.t.sol))
- [x] Invariant tests with handler: I1 (anchor once), I2 (`anchoredAt` immutable), I4 (sender isolation); checked against a mutant ([contracts/test/invariant](contracts/test/invariant/))
- [x] Fuzz tests: I3 (zero root reverts), I5 (`verifyPost` iff leaf in an anchored tree); I6 (no ETH accepted) unit + fuzz
- [x] CREATE2 deployment script; deterministic deployment proxy present on the 3 testnets; predicted address `0x36b5D5F0D176b96013678FC69C34038897fAF382` ([contracts/script/DeployPostAnchor.s.sol](contracts/script/DeployPostAnchor.s.sol))
- [ ] Deploy to Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia; record the address (needs a funded deployer key)

### Benchmark (`contracts/bench`, `packages/bench`)

- [x] Baseline contracts: B0, B1, B2, ours-lite ([contracts/bench](contracts/bench/), [ADR-001](docs/decisions/ADR-001-efficiency-definition.md))
- [x] Gas per batch and per post for N = 1, 10, 100, 500, 1000, real receipts under Ethereum mainnet rules, deterministic and reproducible ([packages/bench/src/gas-bench.mjs](packages/bench/src/gas-bench.mjs))
- [x] Measured crossovers: ours vs B1 from N = 3, ours vs B2 from N = 20 (estimated 34), ours-lite vs B2 from N = 2
- [x] Calldata pricing probe on the six public chains: EIP-7623 floor on Ethereum and Base, none on Arbitrum, Ethereum Sepolia on a different schedule ([packages/bench/src/calldata-floor-probe.mjs](packages/bench/src/calldata-floor-probe.mjs))
- [x] Dated results in [packages/bench/results](packages/bench/results/)
- [x] Gas tables in the README and docs/efficiency.md; Estimates in ADR-001, ADR-004, ADR-005 and ADR-009 replaced with measured values
- [ ] Money conversion: mainnet price snapshot and L1 data fee oracles (confirm method names)
- [ ] Arbitrum execution gas (no calldata floor there) and the L2 L1-data fee
- [ ] Identify which upgrade set Ethereum Sepolia's current gas schedule
- [ ] Apply the revisit criterion of [ADR-005](docs/decisions/ADR-005-commitment-merkle-tree.md) once typical batch sizes are known, and record the outcome

### `packages/core`

- [ ] EIP-712 types and domains: `Post`, `PublishIntent` ("Phi Posts"), `Receipt` / `Deadline` ("Phi Receipts")
- [ ] `postHash`, `imageHash`, leaf encoding, Merkle helpers on `@openzeppelin/merkle-tree`, with fixtures shared with the Solidity tests
- [ ] Schemas: post JSON, manifest, proof bundle, trusted keys
- [ ] Username and caption normalisation (NFC, `[a-z0-9_]`)
- [ ] WebP RIFF chunk parser: strip in the client, detect with an allowlist on the server ([ADR-003](docs/decisions/ADR-003-arweave-layout-image-limits.md))

### `packages/verifier`

- [ ] Library: hints parsing, Arweave fetch by ID, hash recomputation, root rebuild, on-chain checks, trusted-keys windows, receipt verification
- [ ] Bounded scan and the four per-chain verdicts ([ADR-015](docs/decisions/ADR-015-signed-receipts.md))
- [ ] CLI: `pnpm verify <postHash> [--hints <bundle.json>]`

### Docs and diagrams

- [x] PNG export script for the Archify diagrams, versioned in the repo ([docs/diagrams/export-png.mjs](docs/diagrams/export-png.mjs))
- [ ] Timeline (batching example) and Waterfall (latency breakdown) diagrams from real benchmark data
- [~] Key benchmark numbers in the README TL;DR (gas done, USD pending)

### Research (To verify items that can change the design)

- [~] Openfort ([ADR-011](docs/decisions/ADR-011-identity-openfort.md)): resolved from the official docs: EOA account type (plain ECDSA signatures), 2-of-3 OpenSigner shares, recovery modes that keep the platform from reconstructing keys, allowed domains, no co-signer. Still open, to test at the start of Tier 3: a domain without `chainId`, and whether the payload leaves the iframe
- [ ] Base stack lineage and its L1 data fee oracle ([ADR-007](docs/decisions/ADR-007-chain-selection.md))
- [ ] Turbo: default `anchor` field, behaviour on an existing data item ID, upload rate limits ([ADR-002](docs/decisions/ADR-002-storage-arweave-turbo.md))

## Tier 2: minimal pipeline (`packages/backend`)

- [ ] Postgres migrations and job queue (`SELECT ... FOR UPDATE SKIP LOCKED`)
- [ ] `Signer` / `KeyStore` interface with the KMS simulator
- [ ] API: intent validation, username ownership, nonce, deadline, `createdAt` skew, media checks, rate limits, signed receipts
- [ ] Storage worker: image then post JSON to Turbo with the platform key
- [ ] Batcher per chain (Tmax / Nmax), manifest upload
- [ ] Anchor worker per chain: nonce manager, gas bump, receipt check before retry, same-nonce replacement for re-batches ([ADR-008](docs/decisions/ADR-008-multichain-orchestration.md))
- [ ] Tracker (soft to safe) and indexer keyed by `(chainId, sender, root)`
- [ ] `GET /proof/:postHash`, on-demand signature disclosure with audit log
- [ ] `DEMO_MODE` with the protected flush-now endpoint ([ADR-018](docs/decisions/ADR-018-abuse-cost-control.md))
- [ ] Backend service in `docker-compose.yml`

## Tier 3: minimal web (`packages/web`)

- [ ] Compose: client-side compression, metadata stripping, normalisation, Openfort EIP-712 signing
- [ ] Chain selector (1 to 3) and per-chain status: Accepted / Published / Settled
- [ ] IndexedDB persistence of signatures and intent fields; proof bundle download
- [ ] Verify page on the verifier library, with the "convenience, not independent verification" note
- [ ] Demo-only flush-now button; efficiency panel linking benchmark results
- [ ] Public demo URL in the README

## Log

| Date | Change |
| ---- | ------ |
| 2026-11-07 | Block B completed: scaffold, ADR-001 to ADR-019, efficiency and threat model, six diagrams. Roadmap created. |
| 2026-11-07 | Tier 1 contract work: `PostAnchor`, 16 tests (I1 to I6), CREATE2 script, gas benchmark with five variants and the calldata probe. Openfort research folded into ADR-011 (EOA account type, recovery modes). |
