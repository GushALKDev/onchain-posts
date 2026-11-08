# @phi/verifier

A browser-compatible library (fetch + viem, no Node-only APIs outside `src/cli.ts`) with a thin CLI on top. It verifies a post using only public sources: an Arweave gateway, public RPCs and `config/trusted-keys.json`. The web Verify page and the CLI run the same library code. It never imports `@phi/backend`.

## What it checks

Principle: **untrusted hints, independent verification** (README section 9, ADR-014, ADR-015).

1. **Hints** (a `phi.proof/1` bundle from `GET /proof/:postHash` or the user's private copy) are parsed and only used to save discovery time. Hints for another `postHash` are ignored.
2. **Receipt**: the signer is recovered from the "Phi Receipts" EIP-712 domain and must be a `receipt` key in the trust root at `acceptedAt` (a consistency check only, ADR-015). An invalid receipt means no deadline is trusted, so no "pending" or "omitted" claim is made from it.
3. **Anchors**: each one is accepted only if `PostAnchor.anchoredAt(sender, root)` is non-zero, the sender is a `relayer` key for that chain at the anchor timestamp, the leaf belongs to this post and `PostAnchor.verifyPost` accepts the proof.
4. **Scan** (`scan: true`): reads `BatchAnchored` events of the trusted relayers, fetches each manifest, checks that it rebuilds to the anchored root and looks for the post. Without a receipt it needs a start time (`since`). With a receipt it is the bounded scan from `acceptedAt` to `anchorBy` + margin (120 s by default, design parameter).
5. **Content**: the post JSON is fetched by the Arweave ID pinned in the leaf (or from the hints when there is no verified anchor), validated against `phi.post/1`, and its fields must hash to the `postHash`; the image bytes must hash to `image.hash`. Chunks outside the WebP allowlist are reported as warnings.
6. **Authorship** (private bundle with `signature` and `intent`): the signer is recovered from the `PublishIntent`, `keccak256(signature)` must equal the `sigCommit` in the anchored leaf, and every anchored chain must be one the author signed.

## Verdicts per chain

| Verdict | Condition |
| ------- | --------- |
| `anchored` | Verified anchor; `late` is set when the anchor time is after `anchorBy` |
| `pending` | Not found, `anchorBy` not reached |
| `deadline-passed-not-scanned` | `anchorBy` passed and the bounded scan was not run, was incomplete (a manifest could not be fetched or did not rebuild) or its window has not closed yet |
| `omitted` | The bounded scan covered every trusted batch in the closed window and none contains the post |
| `not-found` | No receipt deadline for that chain and the scan did not find the post |

`ok` is true when the content is valid, at least one chain is anchored, nothing is omitted, the receipt (if any) is valid and authorship (if checked) is proven.

## Usage

Library:

```ts
import { createPublicSources, verifyPublishedPost } from '@phi/verifier';
const report = await verifyPublishedPost(postHash, { hints, scan: true }, { sources: createPublicSources({ rpcUrls, gateway }), trustedKeys });
```

CLI (from the repository root):

```bash
pnpm verify <postHash> [--hints <bundle.json> | --hints-url <url>] [--trusted-keys <file>] [--rpc <chainId>=<url>]... [--gateway <url>] [--scan] [--since <time>] [--json]
```

Exit code 0 when `ok`, 1 when not verified, 2 on usage errors. Independent verification means running the CLI from the public repository at a pinned commit, or with a trusted-keys file you supply. The Verify page in the web app runs the same library, but the platform serves both the page and its copy of the trust root, so it is a convenience.

## Tests

`pnpm test` (17 tests) starts two local anvil nodes with the chain IDs of Base Sepolia and Arbitrum Sepolia, deploys `PostAnchor` at its real CREATE2 address, plays the platform with an in-memory Arweave, and checks: the happy path with a pending third chain, discovery without hints, `omitted` only after a complete bounded scan, an incomplete scan, a late anchor, untrusted and revoked relayers, a receipt from an untrusted key, a tampered proof, a leaf from another post, altered post JSON and image, authorship proof, and an anchor on a chain the author did not sign. The CLI is tested as a child process against anvil and a local HTTP gateway.

## Limits

- `config/trusted-keys.json` still holds zero-address placeholders and `PostAnchor` is not deployed on the testnets yet, so the CLI cannot verify a real post until both exist (ROADMAP).
- Discovery without hints and without a receipt scans from `since` to the head; on chains with fast blocks that means many log requests (chunks of 10,000 blocks).
