# @onchain-posts/core

Shared TypeScript, browser-compatible (no Node-only APIs in `src`). Used by `web`, `backend` and `verifier` so that hashing, normalisation and metadata checks are identical everywhere.

## Modules

| Module | Exports | Decision |
| ------ | ------- | -------- |
| `eip712.ts` | `POSTS_DOMAIN`, `POST_TYPES`, `RECEIPTS_DOMAIN`, `RECEIPT_TYPES`, `postHash`, `imageHash`, `publishIntentDigest`, `recoverIntentSigner`, `sigCommit`, `receiptDigest`, `recoverReceiptSigner` | ADR-012, ADR-013, ADR-015 |
| `merkle.ts` | `leafData`, `leafHash`, `buildBatch` (tree + `onchain-posts.manifest/1`), `treeFromManifest`, `manifestRootMatches`, `inclusionProof`, `verifyInclusion` | ADR-005, ADR-014 |
| `arweave.ts` | `arweaveIdToBytes32`, `bytes32ToArweaveId` (rejects non-canonical IDs that would alias another one) | ADR-014 |
| `normalize.ts` | `normalizeUsername`, `normalizeCaption` (client, before signing); `checkUsername`, `checkCaption` (server, check only) | ADR-003, ADR-012 |
| `webp.ts` | `parseWebpChunks`, `inspectWebp` (dimensions + chunks outside the allowlist), `stripWebpMetadata` | ADR-003 |
| `schemas.ts` | zod schemas for the post JSON, manifest, signed receipt, proof bundle and `config/trusted-keys.json` | ADR-009, ADR-014, ADR-015 |
| `trustedKeys.ts` | `isTrustedKey` (role, chain, validity window), `relayersForChain`; the zero-address placeholder is never trusted | ADR-009 |
| `constants.ts` | chain IDs, predicted `PostAnchor` address (also the EIP-712 `verifyingContract`), schema names, limits | ADR-003, ADR-007, ADR-009 |

Limits (design parameters): image at most 95 KiB and 1080 px per side; caption at most 1,000 Unicode code points after NFC (which bounds it to 4,000 UTF-8 bytes); username `[a-z0-9_]`, 3 to 30 characters; at most 3 chains per post.

## Commands

```bash
pnpm test        # vitest: 40 tests
pnpm typecheck   # src, tests and scripts
pnpm build       # dist/ with type declarations
pnpm fixtures    # regenerate test/fixtures/merkle-fixture.json after changing leaf or tree code
```

## Cross-implementation checks

- The EIP-712 tests recompute `postHash`, the intent digest (domain without `chainId`) and the receipt digest (domain with only name and version) with an independent encoding written from the specification, and compare them with viem.
- `test/fixtures/merkle-fixture.json` holds 7 real posts signed with a test key. `contracts/test/CoreFixture.t.sol` rebuilds the root with the Solidity builder and checks every proof in `PostAnchor.verifyPost`; `test/fixture.test.ts` fails if the committed fixture drifts from the code.

## Not covered yet

The WebP parser is tested on synthetic containers; it will be checked against real encoder output when the web app produces WebP files.
