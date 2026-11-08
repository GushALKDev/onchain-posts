# @phi/web

Minimal web app ([ADR-019](../../docs/decisions/ADR-019-web-app-scope.md)): Vite + React, importing `@phi/core` and the `@phi/verifier` library. The live demo is not the efficiency proof (small batches, demo mode); the benchmark is.

## Pages

| Page | What it does |
| ---- | ------------ |
| Feed (default) | Latest posts from `GET /posts`, refreshed every 10 s: image from Arweave (gateways tried in order), caption, username and one stage pill per chain. |
| Post | Everything public about one post, each piece with its check: journey timeline, the signed EIP-712 struct, every Arweave item (Turbo status, owner and tags from GraphQL, live fetch with hash checks, JSON viewer), per-chain anchors (deadline, transaction, relayer trust, fee from the receipt, Merkle path recomputed level by level), receipt signer, inline verification, privacy panel, bundle downloads. Backed by `GET /posts/:postHash`. |
| How it works | The seven steps, what is and is not guaranteed, deployment links and three Archify diagrams. |
| Compose | Username, caption and optional image. The image is resized to 1080 px and re-encoded to WebP in the browser, lowering quality from 0.9 to 0.5 until it fits 95 KiB (rejected otherwise); the shared RIFF parser strips and checks the chunks. Username and caption are normalised (NFC) before signing, because the signature freezes the bytes (ADR-003, ADR-012). The user picks 1 to 3 chains and signs the EIP-712 `PublishIntent`. A live preview shows the exact bytes that will be signed, and the submit shows its three steps (sign, receipt, local save). |
| My posts | Posts signed in this browser (list from IndexedDB, details from the API), opening the same post page. There, "Download private bundle" combines the public hints from `GET /proof/:postHash` with the signature and intent fields kept in IndexedDB (ADR-014). |
| Verify | Runs the verifier library from public sources, with optional bundle and optional trust root file. Shows the convenience notice: the platform serves this page and its copy of `trusted-keys.json`, so independent verification means the CLI from the public repository, or a trust root you supply. |
| Efficiency | Gas per post and end-to-end USD from the committed benchmark results. |

In demo mode a "Flush now" button on the post page asks for the operator token (it is never embedded in the app) and calls the protected endpoint (ADR-018).

## Signing

The app signs through a `PostSigner` interface (`src/signer.ts`). With `VITE_OPENFORT_PUBLISHABLE_KEY` and `VITE_OPENFORT_SHIELD_PUBLISHABLE_KEY` set, it signs with the **Openfort embedded EOA** (ADR-011): email code or guest sign-in, EOA account type, password recovery. Every Openfort signature is checked locally before use: it must recover to the account for the exact payload. Without those keys, the app falls back to a **development key** generated in the browser and says so on every page.

Observed on 2026-11-08 with `@openfort/openfort-js` 2.6.4: Openfort signs the chain-agnostic "Phi Posts" domain as given, and no request to Openfort carried the payload while signing (details in ADR-011).

## Running locally

```bash
# The web app reads the repository-root .env (see .env.example): set VITE_API_URL and the RPCs
pnpm --filter @phi/web dev                        # http://localhost:5173
```

The backend must list the web origin in `WEB_ORIGINS`. Arweave gateways come from `VITE_ARWEAVE_GATEWAYS` (comma-separated, tried in order; default `turbo-gateway.com`, `ardrive.net`, `arweave.net`). ar.io gateways serve a Turbo upload at once, while `arweave.net` lagged about 6 minutes on 2026-11-08 (ADR-002). With `STORAGE_MODE=memory`, set it to the backend's `/dev-gateway`. The post page also reads the ar.io GraphQL index (`VITE_ARWEAVE_GRAPHQL`) and Turbo's public status endpoint.

## Tests and checks

- `pnpm test`: 6 unit tests (submission building and signature recovery, base64 of large images, development signer, private bundle).
- `pnpm build`: typecheck and production build.
- Browser run on 2026-11-08 in headless Chrome against a local stack (backend, Postgres, two local chains with `PostAnchor`): compose with a real 962 KB PNG, publish on two chains, demo flush, Published with explorer links, Verify reported VERIFIED. Details in ADR-019.

## Limits

- Openfort guest accounts are real accounts in the Openfort project; each guest is a new key, so a username claimed by one guest cannot be reused by another.
- Browsers that cannot encode WebP from a canvas get an explicit error.
- The production bundle is over 500 kB (viem, the Merkle library and zod); code splitting is possible if it matters.
- Signatures in IndexedDB are only as safe as the browser that holds them (ADR-014).
