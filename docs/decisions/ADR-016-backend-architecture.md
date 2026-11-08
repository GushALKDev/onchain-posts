# ADR-016: Backend architecture

Status: Accepted
Confidence: High
Reversibility: Reversible
Date: 2026-11-07

## Context

The backend accepts signed intents, issues receipts, stores content on Arweave, batches per chain, anchors with the relayer, tracks confirmations and serves proof hints. It also holds the privacy boundary of the system ([ADR-013](ADR-013-author-privacy-sigcommit.md)): the mapping between users, signer addresses and posts.

Constraints: one week of delivery time, Tier 2 of the delivery priority (a minimal pipeline), three testnets, honest retries and idempotency ([ADR-008](ADR-008-multichain-orchestration.md)), and keys that must never live in the database.

## Decision

TypeScript, `viem`, `@ardrive/turbo-sdk`, `@openzeppelin/merkle-tree`. Postgres in Docker as database AND queue (`SELECT ... FOR UPDATE SKIP LOCKED`, so several workers never take the same job). Deployed with `docker compose` on a VPS. The PoC runs as a single process (API + workers); the component split below is logical, not necessarily separate containers.

### Components

| Component | Responsibilities |
| --------- | ---------------- |
| API (stateless) | Validates the signature, username ownership, nonce, deadline, `createdAt` skew, sizes and real MIME (magic bytes), absence of EXIF/XMP chunks (RIFF parser from `packages/core`), normalisation already applied; recomputes `imageHash` and `postHash`; applies rate limits; issues the receipt ([ADR-015](ADR-015-signed-receipts.md)). Serves `GET /proof/:postHash` with untrusted hints, including the `pending` list, rate-limited per IP. Exposes a flush-now endpoint in DEMO_MODE only, protected by `DEMO_FLUSH_TOKEN` and rate-limited ([ADR-018](ADR-018-abuse-cost-control.md)). Serves the on-demand signature disclosure to the authenticated owner only ([ADR-013](ADR-013-author-privacy-sigcommit.md)) |
| Storage worker | Uploads the image, then the post JSON, to Turbo with the platform Arweave key; checks for an existing upload before retrying |
| Batcher (one per chain) | Applies Tmax / Nmax ([ADR-006](ADR-006-batching-policy.md)); builds the tree; uploads the manifest; creates the anchor job |
| Anchor worker (one per chain) | Signs through the Signer interface (KMS simulator in the PoC); local nonce manager; gas bumping; checks the receipt of the original transaction before any retry; same-nonce replacement for re-batches ([ADR-008](ADR-008-multichain-orchestration.md)) |
| Tracker | Moves anchors from soft to safe ([ADR-017](ADR-017-confirmation-semantics.md)); produces and updates proof bundles as each chain lands |
| Indexer | Indexes `BatchAnchored` events keyed by `(chainId, sender, root)` ([ADR-008](ADR-008-multichain-orchestration.md)) |

### States

- Per post: `RECEIVED -> STORED`.
- Per (post, chain): `QUEUED -> BATCHED(root) -> SUBMITTED(txHash) -> ANCHORED (soft) -> SETTLED (safe)`, with `RETRYING` and `FAILED` (alert).
- A post enters `QUEUED` only after `STORED`: no anchor ever points to missing data ([ADR-008](ADR-008-multichain-orchestration.md)).

### Key and secret separation

| Key or secret | Role |
| ------------- | ---- |
| Arweave data-item key | Signs uploads; appears as ANS-104 `owner` instead of the user ([ADR-002](ADR-002-storage-arweave-turbo.md)) |
| Relayer key(s) | Send anchor transactions; listed with role `relayer` per chain |
| Receipt key | Signs receipts; listed with role `receipt` |
| Signature-at-rest encryption key | Encrypts stored user signatures ([ADR-013](ADR-013-author-privacy-sigcommit.md)) |
| `DB_HMAC_SECRET` | Pseudonymises signer addresses in the database |
| `DEMO_FLUSH_TOKEN` | Protects the demo flush-now endpoint |

All of them live outside the database. Production: KMS (secp256k1 signing support in AWS KMS: To verify). PoC: a simulator behind the same `Signer` / `KeyStore` interface, so swapping it for a real KMS changes configuration, not code paths.

### Privacy boundary rules (from ADR-013)

- Signer addresses are stored as `HMAC(signerAddress, DB_HMAC_SECRET)` only.
- User signatures are encrypted with the external key.
- Proof bundles served publicly never include the signature.
- The signer address recovered in memory during verification is never written to logs, traces, metrics labels or error messages.
- Request logging redacts request bodies that contain signatures.

### Trusted keys

The relayer addresses in use and the receipt key address are listed in `config/trusted-keys.json` with `role`, `validFrom` and `revokedAt` ([ADR-009](ADR-009-anchor-contract.md)). Rotation = add a new entry. Revocation = set `revokedAt` (off-chain; the contract has no admin). `node dist/print-keys.js` prints the public addresses of the keystore in that format; the startup log does not, because the logger redacts every address.

### Implementation in the PoC (2026-11-08)

Implemented in [`packages/backend`](../../packages/backend/README.md): Hono API, postgres.js, the workers above in one process, the KMS simulator, Docker image and `docker compose` service. Simplifications, each deliberate and reversible:

| Simplification | Why acceptable in the PoC | Production path |
| -------------- | ------------------------- | --------------- |
| One in-flight anchor transaction per chain; the nonce is read from the chain | Batches leave every Tmax (30 s on the L2s), so one transaction at a time is not a bottleneck, and no local nonce state can drift | Local nonce manager with several pending transactions |
| A stuck transaction is only fee-bumped, never re-batched with newer posts | Re-batching needs the same-nonce rule of ADR-008 plus orphan-manifest handling; bumping covers the failure | Implement re-batching as specified in ADR-008 |
| Usernames are claimed by the first signer that posts with them | Shows the ownership check; there are no accounts yet | Usernames bound to platform accounts at sign-up |
| Rate limits are in-memory counters | Single process | Shared store, or rate limiting at the edge |
| No cross-instance lock for the anchor worker | Single process; the contract still rejects duplicate roots | Postgres advisory lock per chain |
| `STORAGE_MODE=memory` for local runs and tests | Turbo uploads are permanent and public | `STORAGE_MODE=turbo` |
| KMS simulator (keys in a local file outside the database) | Same `KeyStore` interface as a KMS | KMS-backed `KeyStore` |

Finding from the tests: a replacement transaction must reuse the original gas limit. Re-estimating gas for the replacement runs against the pending state, where the original transaction has already anchored the root, so the estimate reverts with `AlreadyAnchored`.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Postgres as database and queue (chosen) | One service; transactional state transitions and job claims in the same database; `SKIP LOCKED` gives safe concurrent workers | Not a dedicated queue; throughput limits at high scale (To verify with load testing, not needed for the PoC) | Chosen |
| SQLite | Zero setup | Single writer; harder to use as a concurrent queue | Workers contend on one writer |
| Redis-based queue (for example BullMQ) | Mature job semantics | Extra service; job state and post state in two systems | Extra moving part for no PoC gain |
| Real KMS in the demo | Production-like key handling | Setup time and cloud dependency in a one-week exercise | Simulator behind the same interface |
| Separate containers per component | Independent scaling | More deployment work | Logical split first; physical split later if needed |

## Consequences

Positive:

- One process and one database for the PoC, with a component split that maps to separate services later.
- Idempotent retries rest on database state plus on-chain duplicate rejection.
- A database dump alone does not reveal user addresses or signatures.

Negative:

- Postgres is a single point of failure in the PoC.
- The KMS simulator holds keys in a local file or environment: acceptable for testnets only.

Follow-ups:

- Postgres migrations and the `Signer` interface in `packages/backend` (later block).
- Alerting on `FAILED`, on budget caps ([ADR-018](ADR-018-abuse-cost-control.md)) and on any receipt deadline at risk.

## Evidence

- `FOR UPDATE SKIP LOCKED`: "With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped"; the same paragraph says this inconsistent view suits queue-like tables, not general-purpose work (Verified 2026-11-07: https://www.postgresql.org/docs/current/sql-select.html).
- Tests (`packages/backend`, 37 at this commit, against a real Postgres in Docker and two local chains): every acceptance check, the privacy boundary (no address or signature in clear in the database), disclosure, demo flush, the full pipeline to SETTLED with `@onchain-posts/verifier` accepting the result, and the anchor worker failure cases of ADR-008.
- Smoke run on 2026-11-08: the Docker image against a local chain and Postgres accepted two posts, anchored them in one batch after a demo flush, and served a proof bundle that verifies against the anchored root.
- To verify: AWS KMS support for secp256k1 signing keys suitable for Ethereum transactions and EIP-712 signatures.
- To verify: Turbo upload rate limits ([ADR-010](ADR-010-gasless-relayer.md)).
