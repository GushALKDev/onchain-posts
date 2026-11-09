# @onchain-posts/backend

API, workers and the KMS-simulator key store, in one process for the PoC ([ADR-016](../../docs/decisions/ADR-016-backend-architecture.md)). Postgres is both the database and the job queue.

## Endpoints

| Endpoint | Purpose |
| -------- | ------- |
| `POST /posts` | Body `{ intent, signature, image }` (image as base64 WebP, or null). Runs every check below, stores the post and returns `202 { postHash, receipt }` with one `anchorBy` per chain. |
| `GET /proof/:postHash` | **Untrusted verification hints**: the public `onchain-posts.proof/1` bundle, partial while chains are pending (`anchors` with Merkle proofs, `pending` with `anchorBy`, the receipt). Never contains the user signature. `202` while the post is not stored yet. |
| `GET /posts` | Latest posts for the feed, newest first, with `?limit=` (default 20, at most 50) and `?before=` (an `acceptedAt`) for paging. Public data only: no address, HMAC, signature or intent fields. |
| `GET /posts/:postHash` | One post with its receipt and, per chain, the batch, transaction, timestamps and Merkle proof, for the public post page. Same public data only. |
| `GET /status/:postHash` | Per-chain stage for the web app: `accepted`, `published` (anchored, soft) or `settled` (safe head), plus the internal state, tx hash and block. |
| `POST /disclosure` | Body `{ postHash, issuedAt, signature }`, where the signature is an EIP-191 signature of the disclosure message by the author's key. Returns the stored signature and private intent fields to the author only, and writes the audit log (ADR-013). Each signed request is served once: a replay inside the 5-minute freshness window gets 409. |
| `POST /demo/flush` | Only when `DEMO_MODE=true`. Needs header `x-demo-flush-token`; one flush per chain per minute (ADR-018). |
| `GET /health` | Liveness. |

Checks on `POST /posts` (ADR-003, ADR-012, ADR-016): body shape, `contentType` is `post`, chains supported and not repeated, deadline in the future and at most 1 hour ahead, `createdAt` within 5 minutes of server time, username and caption already normalised, image is a WebP with only allowlisted chunks, at most 95 KiB and 1080 px per side, image bytes hash to `imageHash`, a 65-byte EOA signature that recovers, username owned by the signer, nonce not reused, post not already submitted, per-account and per-IP rate limits, daily cap. Every limit is a design parameter in `src/config.ts` or `@onchain-posts/core`.

## Pipeline

| Worker | What it does |
| ------ | ------------ |
| Storage | Uploads the image, then the post JSON, with the platform Arweave key (Turbo) and the ADR-014 tags (no username tag). Only stored posts are queued for batching. Gives up after 5 failed attempts. |
| Batcher (per chain) | Flushes the queue at Nmax, after Tmax, or on a demo flush; builds the tree and `onchain-posts.manifest/1`, uploads the manifest. A batch is anchored only after its manifest is stored. |
| Anchor (per chain) | One in-flight transaction per chain. Checks `anchoredAt` before sending (adopts a root already on-chain after a crash), marks a batch FAILED when the anchor would revert, replaces a stuck transaction with the same nonce and higher fees after 60 s, reusing the original gas limit. |
| Tracker (per chain) | ANCHORED becomes SETTLED when the chain's `safe` block covers the anchor block. |

States: per post `RECEIVED -> STORED` (or `FAILED`); per (post, chain) `WAITING -> QUEUED -> BATCHED`, then the batch state `CREATED -> READY -> SUBMITTED -> ANCHORED -> SETTLED` (or `FAILED`).

## Privacy boundary (ADR-013)

- Signer addresses are stored only as `HMAC(address, DB_HMAC_SECRET)`; the secret is an environment variable, not in the database.
- User signatures are stored only encrypted with AES-256-GCM, with the postHash as additional data, under a key from the key store (outside the database).
- The logger never prints request bodies and redacts anything shaped like an address or a signature.
- A test dumps the `posts` and `usernames` tables and checks that neither the user's address nor the signature appears.

## Running

```bash
cp .env.example .env        # at the repository root: set POSTGRES_*, DB_HMAC_SECRET, the RPC URLs, STORAGE_MODE
docker compose up --build   # Postgres + backend on :8080
docker compose exec backend node dist/print-keys.js   # public relayer and receipt addresses for config/trusted-keys.json
```

The relayer address printed by `print-keys` needs testnet ETH on each enabled chain. With `STORAGE_MODE=turbo` every upload goes to Arweave: permanent and public. Items up to 105 KiB are free within Turbo's 10 MiB lifetime allowance per wallet (ADR-002), enough for the PoC.

Without Docker: `pnpm --filter @onchain-posts/backend build && node packages/backend/dist/main.js` with the same variables.

## Deploying (Dokploy)

The live backend runs this repository's `docker-compose.yml` as a Dokploy Compose service, behind Dokploy's Traefik proxy:

- **Environment.** The backend variables of `.env.example`, with new production secrets (`POSTGRES_PASSWORD`, `DB_HMAC_SECRET`, `DEMO_FLUSH_TOKEN`), `PORT` set to the port the proxy targets, `WEB_ORIGINS` set to the web origin and `TRUSTED_PROXY=true`, so the per-IP rate limit reads the client address from the `X-Forwarded-For` header Traefik writes instead of the proxy's own address. Never `DEPLOYER_PRIVATE_KEY` or `VITE_*`. Set it before adding the domain: Dokploy interpolates the compose file to list its services, and the required variables make that fail while they are missing. Environment changes apply on the next deploy.
- **Domain.** On the `backend` service, container port equal to `PORT`, HTTPS with Let's Encrypt. Ports are published on loopback only; the proxy reaches the container over the Docker network. Postgres gets no domain.
- **Keys.** The KMS simulator keystore lives in the `keystore` volume. To keep the funded relayer and the keys listed in `config/trusted-keys.json`, copy the keystore into the volume after the first deploy (`/data/keystore.json`, owned by `node`, mode 600), restart, and check that `node dist/print-keys.js` prints the trusted addresses. Otherwise the backend generates new keys, which must be funded and added to the trust root.
- **One instance per relayer key.** Two backends with the same relayer key would race on its nonce.

## Tests

`pnpm test` (43 tests) runs against a throwaway Postgres container (Docker) and, for the pipeline, two local anvil nodes with `PostAnchor` at its real CREATE2 address:

- foundation: config, migrations, KMS simulator, HMAC, signature encryption, log redaction;
- API: acceptance, 13 rejection cases, oversize image, username ownership, nonce reuse, duplicate post, rate limit, proof and status before storage, disclosure and its replay, demo flush, and the no-address-in-the-database check;
- pipeline: three posts from submission to SETTLED on two chains in one batch per chain, accepted by `@onchain-posts/verifier` (including authorship after disclosure); demo flush; stuck-transaction replacement with a single anchor on-chain, also after the node dropped the original; crash adoption; would-revert batch marked FAILED; storage failures.

## PoC simplifications

Listed with their production path in ADR-016: one in-flight transaction per chain, no re-batching of stuck batches, first-come usernames, in-memory rate limits, no cross-instance lock, KMS simulator.
