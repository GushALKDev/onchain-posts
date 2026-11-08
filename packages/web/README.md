# @phi/web

Minimal web app ([ADR-019](../../docs/decisions/ADR-019-web-app-scope.md)): Vite + React, importing `@phi/core` and the `@phi/verifier` library. The live demo is not the efficiency proof (small batches, demo mode); the benchmark is.

## Pages

| Page | What it does |
| ---- | ------------ |
| Compose | Username, caption and optional image. The image is resized to 1080 px and re-encoded to WebP in the browser, lowering quality from 0.9 to 0.5 until it fits 95 KiB (rejected otherwise); the shared RIFF parser strips and checks the chunks. Username and caption are normalised (NFC) before signing, because the signature freezes the bytes (ADR-003, ADR-012). The user picks 1 to 3 chains and signs the EIP-712 `PublishIntent`. |
| My posts | Posts signed in this browser. Each shows Accepted / Published / Settled per chain (ADR-017), the receipt deadline and explorer links, refreshed every 3 s. "Download proof bundle" combines the public hints from `GET /proof/:postHash` with the signature and intent fields kept in IndexedDB (ADR-014). |
| Verify | Runs the verifier library from public sources, with optional bundle and optional trust root file. Shows the convenience notice: the platform serves this page and its copy of `trusted-keys.json`, so independent verification means the CLI from the public repository, or a trust root you supply. |
| Efficiency | Gas per post and end-to-end USD from the committed benchmark results. |

In demo mode a "Flush now" button asks for the operator token (it is never embedded in the app) and calls the protected endpoint (ADR-018).

## Signing

The app signs through a `PostSigner` interface (`src/signer.ts`). With `VITE_OPENFORT_PUBLISHABLE_KEY` and `VITE_OPENFORT_SHIELD_PUBLISHABLE_KEY` set, it signs with the **Openfort embedded EOA** (ADR-011): email code or guest sign-in, EOA account type, password recovery. Every Openfort signature is checked locally before use: it must recover to the account for the exact payload. Without those keys, the app falls back to a **development key** generated in the browser and says so on every page.

Observed on 2026-11-08 with `@openfort/openfort-js` 2.6.4: Openfort signs the chain-agnostic "Phi Posts" domain as given, and no request to Openfort carried the payload while signing (details in ADR-011).

## Running locally

```bash
# The web app reads the repository-root .env (see .env.example): set VITE_API_URL and the RPCs
pnpm --filter @phi/web dev                        # http://localhost:5173
```

The backend must list the web origin in `WEB_ORIGINS`. With `STORAGE_MODE=memory`, set `VITE_ARWEAVE_GATEWAY` to the backend's `/dev-gateway` so the Verify page can read content.

## Tests and checks

- `pnpm test`: 6 unit tests (submission building and signature recovery, base64 of large images, development signer, private bundle).
- `pnpm build`: typecheck and production build.
- Browser run on 2026-11-08 in headless Chrome against a local stack (backend, Postgres, two local chains with `PostAnchor`): compose with a real 962 KB PNG, publish on two chains, demo flush, Published with explorer links, Verify reported VERIFIED. Details in ADR-019.

## Limits

- Openfort guest accounts are real accounts in the Openfort project; each guest is a new key, so a username claimed by one guest cannot be reused by another.
- Browsers that cannot encode WebP from a canvas get an explicit error.
- The production bundle is over 500 kB (viem, the Merkle library and zod); code splitting is possible if it matters.
- Signatures in IndexedDB are only as safe as the browser that holds them (ADR-014).
