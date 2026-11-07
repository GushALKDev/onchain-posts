# @phi/backend

API, workers, `Signer` interface with a KMS simulator, and Postgres migrations. Runs as a single process in the PoC (ADR-016).

Not implemented yet.

## Responsibilities

- API (stateless): validates the EIP-712 `PublishIntent` signature, username ownership, nonce, deadline, `createdAt` skew, sizes, real MIME type, absence of metadata chunks and normalisation already applied; recomputes `imageHash` and `postHash`; applies rate limits; issues the signed receipt ("Accepted").
- Storage worker: uploads the image, then the post JSON, to Arweave through Turbo with the platform key.
- Batcher per chain: Tmax / Nmax policy (ADR-006), Merkle tree, manifest upload, anchor job.
- Anchor worker per chain: `Signer` interface (KMS simulator in the PoC), local nonce manager, gas bumping, receipt check before any retry, same-nonce replacement for re-batches (ADR-008).
- Tracker: soft to safe confirmation, builds and updates the public proof bundle as each chain lands (ADR-017).
- Indexer keyed by `(chainId, sender, root)`.
- Postgres migrations: Postgres is both the database and the job queue (`SELECT ... FOR UPDATE SKIP LOCKED`).

## Endpoints (planned)

| Endpoint | Purpose |
| -------- | ------- |
| `POST /posts` | Submit a signed `PublishIntent` with the image; returns the signed receipt. |
| `GET /proof/:postHash` | Returns **untrusted verification hints**: the public proof bundle, partial while some chains are pending (`anchors` + `pending` with each chain's `anchorBy`). Never contains the user signature. Rate-limited per IP. The verifier re-checks everything (ADR-014, ADR-015). |
| Flush now (demo only) | Exists only when `DEMO_MODE` is set; protected by `DEMO_FLUSH_TOKEN` and rate-limited (ADR-018). |
| Signature disclosure | Returns the stored, encrypted-at-rest signature only to its authenticated owner, and records the disclosure in an audit log (ADR-013). |

Privacy boundary rules (ADR-013, ADR-016): signer addresses are stored only as `HMAC(signerAddress, DB_HMAC_SECRET)`; user signatures are encrypted with a key held outside the database; addresses recovered in memory are never written to logs, traces, metric labels or error messages.
