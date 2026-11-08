# Roadmap

Living document: it is updated in the same commit as the work it describes. When an item is completed, tick it and link the evidence (test, results file, ADR update or commit).

Legend: `[x]` done, `[~]` in progress, `[ ]` pending.

Deadline: Friday 2026-11-13. Order of work follows the delivery priority in [README section 12](README.md#12-limitations-and-future-work).

## Status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| Block B | Documentation-first scaffold: repo, README, ADRs, efficiency and threat model, diagrams | Done (2026-11-07) |
| Tier 1 | The evidence and the reasoning: contract, invariant tests, benchmark, `packages/core`, verifier | Done except the testnet deployment, the Timeline and Waterfall diagrams and the open research items |
| Tier 2 | Minimal pipeline: backend, Postgres, Turbo uploads, anchoring on the 3 testnets | Implemented and tested locally; real Turbo uploads and testnet anchoring pending (deployment) |
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
- [x] Money conversion: mainnet price snapshot (Chainlink ETH/USD, base fees), L1 data fee oracles confirmed on mainnet, Turbo list price ([packages/bench/src/cost-snapshot.mjs](packages/bench/src/cost-snapshot.mjs))
- [x] Arbitrum execution gas (cancun-rules proxy, cross-checked with `eth_estimateGas` and state overrides) and the L2 L1-data fee
- [ ] Identify which upgrade set Ethereum Sepolia's current gas schedule
- [ ] Apply the revisit criterion of [ADR-005](docs/decisions/ADR-005-commitment-merkle-tree.md) once typical batch sizes are known, and record the outcome

### `packages/core`

- [x] EIP-712 types and domains: `Post`, `PublishIntent` ("Phi Posts"), `Receipt` / `Deadline` ("Phi Receipts"), checked against an independent encoding written from the specification ([packages/core/src/eip712.ts](packages/core/src/eip712.ts))
- [x] `postHash`, `imageHash`, `sigCommit`, leaf encoding, Merkle helpers on `@openzeppelin/merkle-tree`; the generated fixture is verified by `contracts/test/CoreFixture.t.sol` against `PostAnchor`
- [x] Schemas: post JSON, manifest, proof bundle, signed receipt, trusted keys (zod); `config/trusted-keys.json` validated in the tests
- [x] Username and caption normalisation (NFC, `[a-z0-9_]`, 3 to 30 characters, 1,000 code points)
- [x] WebP RIFF chunk parser: strip in the client, detect with an allowlist on the server ([ADR-003](docs/decisions/ADR-003-arweave-layout-image-limits.md))
- [x] Trusted-key window checks (`isTrustedKey`), zero-address placeholders never trusted

### `packages/verifier`

- [x] Library: hints parsing, Arweave fetch by ID, hash recomputation, root rebuild, on-chain checks, trusted-keys windows, receipt verification, authorship from the private bundle ([packages/verifier/src/verify.ts](packages/verifier/src/verify.ts))
- [x] Bounded scan and the per-chain verdicts, with the late flag and incomplete scans never yielding "omitted" ([ADR-015](docs/decisions/ADR-015-signed-receipts.md))
- [x] CLI: `pnpm verify <postHash> [--hints <bundle.json>] [--scan]`, tested as a child process
- [x] Integration tests against local nodes with `PostAnchor` at its real CREATE2 address (17 tests)
- [ ] Run against the real testnets once `PostAnchor` is deployed and `config/trusted-keys.json` holds the real keys

### Docs and diagrams

- [x] PNG export script for the Archify diagrams, versioned in the repo ([docs/diagrams/export-png.mjs](docs/diagrams/export-png.mjs))
- [ ] Timeline (batching example) and Waterfall (latency breakdown) diagrams from real benchmark data
- [x] Key benchmark numbers in the README TL;DR (gas and USD)

### Research (To verify items that can change the design)

- [~] Openfort ([ADR-011](docs/decisions/ADR-011-identity-openfort.md)): resolved from the official docs: EOA account type (plain ECDSA signatures), 2-of-3 OpenSigner shares, recovery modes that keep the platform from reconstructing keys, allowed domains, no co-signer. Still open, to test at the start of Tier 3: a domain without `chainId`, and whether the payload leaves the iframe
- [~] Base stack lineage ([ADR-007](docs/decisions/ADR-007-chain-selection.md)): Base still exposes the OP Stack `GasPriceOracle` (v1.6.0, Isthmus), used for its L1 data fee; full lineage still open
- [ ] Turbo: default `anchor` field, behaviour on an existing data item ID, upload rate limits ([ADR-002](docs/decisions/ADR-002-storage-arweave-turbo.md))

## Tier 2: minimal pipeline (`packages/backend`)

- [x] Postgres migrations and job queue (`SELECT ... FOR UPDATE SKIP LOCKED`)
- [x] `KeyStore` interface with the KMS simulator; `print-keys` for the public addresses
- [x] API: intent validation, username ownership, nonce, deadline, `createdAt` skew, media checks, rate limits, signed receipts
- [x] Storage worker: image then post JSON through Turbo with the platform key (memory mode for tests and local runs)
- [x] Batcher per chain (Tmax / Nmax, demo flush), manifest upload
- [x] Anchor worker per chain: one in-flight transaction, receipt check before retry, crash adoption, same-nonce fee bump ([ADR-008](docs/decisions/ADR-008-multichain-orchestration.md)); re-batching of stuck batches not implemented (ADR-016)
- [x] Tracker (soft to safe); the batches table is the index of our own anchors, keyed by chain, sender and root
- [x] `GET /proof/:postHash`, `GET /status/:postHash`, on-demand signature disclosure with audit log
- [x] `DEMO_MODE` with the protected flush-now endpoint ([ADR-018](docs/decisions/ADR-018-abuse-cost-control.md))
- [x] Backend service in `docker-compose.yml`; Docker smoke run against a local chain
- [x] 37 tests with Postgres and two local chains, including the full pipeline verified by `@phi/verifier`
- [ ] First real Turbo upload (permanent and public, needs the owner's go-ahead)
- [ ] Anchoring on the three testnets (needs the deployment and a funded relayer)

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
| 2026-11-07 | Benchmark completed in money: Arbitrum gas proxy, L1 data fee oracles, USD per post. Finding: image storage is 96% or more of the end-to-end cost from N = 100 on. |
| 2026-11-07 | `packages/core` implemented: EIP-712, Merkle, schemas, normalisation, WebP parser, trusted keys; 40 vitest tests and a cross-implementation fixture checked by Foundry. |
| 2026-11-08 | `packages/verifier` implemented: library, bounded scan, verdicts, authorship check and CLI; 17 integration tests against local nodes. |
| 2026-11-08 | `packages/backend` implemented: API, workers, KMS simulator, Docker; 37 tests and a Docker smoke run. Finding: a replacement transaction must reuse the original gas limit. |
