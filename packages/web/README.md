# @phi/web

Vite + React + Openfort. Minimal scope, proposed in [ADR-019](../../docs/decisions/ADR-019-web-app-scope.md).

Not implemented yet.

## Responsibilities

- Compose: caption and image, client-side WebP compression, EXIF/XMP stripping with the `@phi/core` RIFF parser, NFC normalisation, all before signing.
- Chain selector (1 to 3 chains) and EIP-712 signing of the `PublishIntent` with the Openfort embedded account (signing identity only, never a transaction sender, ADR-011).
- Live status per stage and per chain: Accepted / Published / Settled, with explorer links (ADR-017).
- Local persistence of each signature in IndexedDB, keyed by `postHash` and bound to the logged-in user, and a "download proof bundle" action (public bundle from `GET /proof/:postHash` plus the local signature, ADR-014).
- Verify page that imports the `@phi/verifier` library (same code as the CLI). It is a convenience, not independent verification: the platform serves both the page and its copy of `config/trusted-keys.json`.
- "Flush now" button, visible only in `DEMO_MODE`, labelled as demo behaviour and backed by the protected endpoint (ADR-018).
