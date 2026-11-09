# Roadmap

Living document: it is updated in the same commit as the work it describes. When an item is completed, tick it and link the evidence (test, results file, ADR update or commit).

Legend: `[x]` done, `[~]` in progress, `[ ]` pending.

Deadline: Friday 2026-11-13. Order of work follows the delivery priority in [README section 12](README.md#12-limitations-and-future-work).

## Status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| Block B | Documentation-first scaffold: repo, README, ADRs, efficiency and threat model, diagrams | Done (2026-11-07) |
| Tier 1 | The evidence and the reasoning: contract, invariant tests, benchmark, `packages/core`, verifier | Done, deployed on the three testnets; Timeline and Waterfall diagrams and some research items open |
| Tier 2 | Minimal pipeline: backend, Postgres, Turbo uploads, anchoring on the 3 testnets | Done: first real post stored through Turbo and anchored on the three testnets (2026-11-08) |
| Tier 3 | Minimal web: compose, per-stage status, Verify page | Done, with Openfort sign-in; live at https://onchain-posts.gushalk.workers.dev |

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
- [x] CREATE2 deployment script; deterministic deployment proxy present on the 3 testnets; predicted address `0xD0fB2A7F1D12C5AF80E49B31Bcb1B4983AD7C5dB` ([contracts/script/DeployPostAnchor.s.sol](contracts/script/DeployPostAnchor.s.sol))
- [x] Deployed to Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia at `0xD0fB2A7F1D12C5AF80E49B31Bcb1B4983AD7C5dB`, same bytecode on all three (README section 11)

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

- [x] EIP-712 types and domains: `Post`, `PublishIntent` ("Onchain Posts"), `Receipt` / `Deadline` ("Onchain Receipts"), checked against an independent encoding written from the specification ([packages/core/src/eip712.ts](packages/core/src/eip712.ts))
- [x] `postHash`, `imageHash`, `sigCommit`, leaf encoding, Merkle helpers on `@openzeppelin/merkle-tree`; the generated fixture is verified by `contracts/test/CoreFixture.t.sol` against `PostAnchor`
- [x] Schemas: post JSON, manifest, proof bundle, signed receipt, trusted keys (zod); `config/trusted-keys.json` validated in the tests
- [x] Username and caption normalisation (NFC, `[a-z0-9_]`, 3 to 30 characters, 1,000 code points)
- [x] WebP RIFF chunk parser: strip in the client, detect with an allowlist on the server ([ADR-003](docs/decisions/ADR-003-arweave-layout-image-limits.md))
- [x] Trusted-key window checks (`isTrustedKey`), zero-address placeholders never trusted

### `packages/verifier`

- [x] Library: hints parsing, Arweave fetch by ID, hash recomputation, root rebuild, on-chain checks, trusted-keys windows, receipt verification, authorship from the private bundle ([packages/verifier/src/verify.ts](packages/verifier/src/verify.ts))
- [x] Bounded scan and the per-chain verdicts, with the late flag and incomplete scans never yielding "omitted" ([ADR-015](docs/decisions/ADR-015-signed-receipts.md))
- [x] CLI: `pnpm verify <postHash> [--hints <bundle.json>] [--scan]`, tested as a child process
- [x] Integration tests against local nodes with `PostAnchor` at its real CREATE2 address (24 tests)
- [x] Verified the first real post from public sources only, with hints and by scanning without hints; scanning adapted to pruned history and log-range limits of public RPCs

### Docs and diagrams

- [x] PNG export script for the Archify diagrams, versioned in the repo ([docs/diagrams/export-png.mjs](docs/diagrams/export-png.mjs))
- [ ] Timeline (batching example) and Waterfall (latency breakdown) diagrams from real benchmark data: not produced in this delivery, they need the latency measurements
- [x] Key benchmark numbers in the README TL;DR (gas and USD)

### Research (To verify items that can change the design)

- [x] Openfort ([ADR-011](docs/decisions/ADR-011-identity-openfort.md)): EOA account type, 2-of-3 shares, recovery modes, allowed domains, no co-signer (docs); domain without `chainId` and payload staying in the iframe (observed 2026-11-08). Dynamic equivalence still open
- [~] Base stack lineage ([ADR-007](docs/decisions/ADR-007-chain-selection.md)): Base still exposes the OP Stack `GasPriceOracle` (v1.6.0, Isthmus), used for its L1 data fee; full lineage still open
- [~] Turbo: the SDK passes an `anchor` only when given; behaviour on an existing data item ID and upload rate limits still open ([ADR-002](docs/decisions/ADR-002-storage-arweave-turbo.md))

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
- [x] 37 tests with Postgres and two local chains, including the full pipeline verified by `@onchain-posts/verifier`
- [x] First real Turbo upload (free tier, 0 winc); `arweave.net` served it about 6 minutes later (ADR-002, ADR-008)
- [x] Anchoring on the three testnets: 47,058 gas on Base and Arbitrum Sepolia as measured locally, 129,078 on Ethereum Sepolia (different schedule)

## Tier 3: minimal web (`packages/web`)

- [x] Compose: client-side resize and WebP re-encoding (quality 0.9 down to 0.5), metadata stripping, normalisation, EIP-712 signing through `PostSigner`
- [x] Chain selector (1 to 3) and per-chain status: Accepted / Published / Settled, with explorer links
- [x] IndexedDB persistence of signatures and intent fields; proof bundle download
- [x] Verify page on the verifier library, with the "convenience, not independent verification" note and an optional user-supplied trust root
- [x] Demo-only flush-now button (token typed by the operator); efficiency panel from the benchmark results
- [x] Browser run in headless Chrome against a local stack: compose, publish on two chains, flush, VERIFIED (ADR-019)
- [x] Openfort sign-in (email code or guest, EOA, password recovery); domain without `chainId` accepted and payload not leaving the iframe, both observed (ADR-011)
- [x] Feed, public post page with every piece of evidence and its check, How it works page, composer preview (ADR-019 scope update)
- [x] Public demo URL in the README: web on Cloudflare Workers, backend and Postgres on a VPS with Dokploy

## Log

| Date | Change |
| ---- | ------ |
| 2026-11-07 | Block B completed: scaffold, ADR-001 to ADR-019, efficiency and threat model, six diagrams. Roadmap created. |
| 2026-11-07 | Tier 1 contract work: `PostAnchor`, 16 tests (I1 to I6), CREATE2 script, gas benchmark with five variants and the calldata probe. Openfort research folded into ADR-011 (EOA account type, recovery modes). |
| 2026-11-07 | Benchmark completed in money: Arbitrum gas proxy, L1 data fee oracles, USD per post. Finding: image storage is 96% or more of the end-to-end cost from N = 100 on. |
| 2026-11-07 | `packages/core` implemented: EIP-712, Merkle, schemas, normalisation, WebP parser, trusted keys; 40 vitest tests and a cross-implementation fixture checked by Foundry. |
| 2026-11-08 | `packages/verifier` implemented: library, bounded scan, verdicts, authorship check and CLI; 17 integration tests against local nodes. |
| 2026-11-08 | `packages/backend` implemented: API, workers, KMS simulator, Docker; 37 tests and a Docker smoke run. Finding: a replacement transaction must reuse the original gas limit. |
| 2026-11-08 | `packages/web` implemented: compose, status, proof bundle, Verify, efficiency; run end to end in a headless browser against a local stack. Openfort waits for a project. |
| 2026-11-08 | Deployed `PostAnchor` on the three testnets, trusted the real relayer and receipt keys, published the first real post through Turbo and verified it from public sources; Openfort sign-in wired and checked. |
| 2026-11-08 | Verifier reads several gateways in order and reports verified / pending / failed (a gateway 404 is pending, not invalid). Backend: `GET /posts` and `GET /posts/:postHash` with timeline columns. Web redesign: feed, post page with live checks, How it works, light and dark themes. |
| 2026-11-08 | `PostAnchor` v2 deployed (`AlreadyAnchored` with parameters, same gas per batch) with new relayer, receipt and Arweave keys; neutral names: `Onchain-Posts` tag, `onchain-posts.*/1` schemas, "Onchain Posts" and "Onchain Receipts" EIP-712 domains; database emptied. |
| 2026-11-09 | Deployed: the web app as static assets on Cloudflare Workers, the backend and Postgres with Dokploy behind Traefik with HTTPS; new production secrets, keys from the PoC keystore. |
