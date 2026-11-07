# ADR-019: Web app scope

Status: Proposed
Confidence: Medium
Reversibility: Reversible
Date: 2026-11-07

## Context

Added requirement A3 asks for a small working web app. The evaluator weighs efficiency and way of thinking, not a running system, and the delivery priority puts the web app in Tier 3, after the evidence (contract, invariant tests, benchmark, `packages/core`, verifier, docs) and after the minimal pipeline (backend, Turbo, three testnets). The web app therefore has one job: make the design visible end to end, with the least code that does it.

Two constraints from other decisions shape it:

- Everything that enters a signed hash must reach its final form in the client before signing ([ADR-003](ADR-003-arweave-layout-image-limits.md), [ADR-012](ADR-012-signature-scheme-eip712.md)).
- The Verify page must use the same code as the independent verifier, but it is served by the platform, so it cannot be presented as independent verification (README section 9).

## Decision

Candidate scope (Proposed: to be confirmed when Tier 3 starts).

### In scope

| Feature | Detail |
| ------- | ------ |
| Login | Email login through Openfort; the embedded account is used only to sign ([ADR-011](ADR-011-identity-openfort.md)) |
| Compose | Caption + optional image. Client-side compression to WebP, EXIF/XMP stripping with the RIFF chunk parser from `packages/core`, NFC normalisation of username and caption, all before signing |
| Chain selector | 1 to 3 chains among Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia |
| Sign and submit | EIP-712 `PublishIntent` signed by the embedded account; the receipt (EIP-712, "Phi Receipts" domain) is checked on arrival against a role `receipt` key ([ADR-015](ADR-015-signed-receipts.md)) |
| Live status | Per stage and per chain: Accepted / Published / Settled, with explorer links and a tooltip that defines Settled for that chain ([ADR-017](ADR-017-confirmation-semantics.md)) |
| Local signature storage | Each signature and its intent fields (`chainIds`, `nonce`, `deadline`) persisted in IndexedDB, keyed by `postHash` and bound to the logged-in Openfort user ([ADR-014](ADR-014-data-model.md)) |
| Download proof bundle | Public bundle from `GET /proof/:postHash` plus the local signature and intent fields ([ADR-014](ADR-014-data-model.md)) |
| Verify page | Imports the verifier LIBRARY from `packages/verifier` (same code as the CLI) and re-checks everything from public sources |
| Flush now | Visible only in DEMO_MODE, labelled as demo behaviour, backed by the protected endpoint ([ADR-018](ADR-018-abuse-cost-control.md)) |
| Efficiency panel | Links to the benchmark results in `packages/bench/results` |

The Verify page shows a visible note: this page is served by the platform together with its copy of `config/trusted-keys.json`, so it is a convenience and not independent verification. The independent path is the CLI from the public repository at a pinned commit, or with a `trusted-keys.json` the user supplies (README section 9).

### Out of scope

Feed, profiles, follows, likes, edits, multiple images per post.

### Stack

Vite + React + Openfort, importing `packages/core` (hashing, normalisation, RIFF parser, schemas) and `packages/verifier` (library). No server-side rendering; the backend is the only server.

The live demo is not the efficiency proof (small batches, demo mode); the benchmark is ([ADR-001](ADR-001-efficiency-definition.md)).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Minimal compose + status + Verify page (proposed) | Shows every stage of the design; reuses `core` and `verifier` | Not a social product | Proposed |
| No web app, CLI only | Least work | A3 asks for a web app; the gasless and signing UX would stay invisible | Fails A3 |
| Full social client (feed, profiles) | Closer to a product | Time spent on UI the evaluator does not weigh; feed and profiles add privacy questions (enumeration) | Out of scope for this exercise |
| Verify page with its own verification code | Simpler bundling | Two implementations that can drift from the CLI | The library is shared instead |
| Server-side image processing | Lighter client | Breaks the signature: the server cannot transform signed bytes ([ADR-003](ADR-003-arweave-layout-image-limits.md)) | Not possible with sign-before-upload |

## Consequences

Positive:

- Every design element (client-side normalisation, signing, receipts, per-chain status, proof bundles, verification) is visible in one flow.
- Web, backend and verifier share hashing and normalisation code, so they cannot disagree on bytes.

Negative:

- Signatures in IndexedDB leak if the browser is shared or compromised, and are lost if site data is cleared ([ADR-014](ADR-014-data-model.md)).
- The Verify page can be mistaken for independent verification; the note mitigates it, the CLI is the real path.

Follow-ups:

- Confirm the scope when Tier 3 starts; cut the efficiency panel first if time is short.
- Document the extra chain-switch step if the constant-`chainId` fallback of [ADR-011](ADR-011-identity-openfort.md) is needed.

## Evidence

- No measurements: this ADR sets scope. The efficiency evidence lives in the benchmark ([ADR-001](ADR-001-efficiency-definition.md)).
- To verify: the Openfort items listed in [ADR-011](ADR-011-identity-openfort.md) (EIP-712 domain without `chainId`, signer EOA signature exposure), which the compose flow depends on.
