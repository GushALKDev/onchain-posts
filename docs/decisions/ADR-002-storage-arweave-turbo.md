# ADR-002: Storage layer: Arweave via the Turbo bundler

Status: Accepted
Confidence: High
Reversibility: Reversible (for future posts: the post hash commits to bytes, not to a location, ADR-004; data already stored stays permanent)
Date: 2026-11-07
Updated: 2026-11-09

## Context

The brief names Arweave "or a better alternative if found". Posts carry an image of up to about 95 KiB (ADR-003) and a caption of up to 1,000 characters. Requirement A1 forbids the user's address or public key from appearing anywhere public, including the storage layer. Users never pay (gasless, ADR-010), so the platform pays for storage.

## Decision

Store everything on **Arweave**, uploaded through **Turbo** (the ar.io / ArDrive bundler). Turbo packs signed ANS-104 data items from many users into one Arweave transaction and pays in AR; the platform pays Turbo with credits.

- Data items are signed with a **platform Arweave key, never with the user's key** (privacy constraint below).
- Three kinds of data items per post and batch are defined in ADR-003.
- Payment: Turbo credits, by card or crypto; x402 payments in USDC on Base are supported (Verified 2026-11-06: https://docs.ar.io/build/upload/ and https://docs.ar.io/build/upload/turbo-credits/).

**Privacy constraint.** The ANS-104 `owner` field is the signer's public key (Verified 2026-11-07: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md, "owner | The public key of the owner"), and Arweave GraphQL can filter by owners (Verified 2026-11-07: https://docs.ar.io/build/access/find-data/, `transactions(owners: [...])`). Signing with the user's key would publish the key and make every post of a user enumerable. With the platform key, all posts share one owner.

**Platform signer key type (nice-to-have, To verify).** The ID of an ANS-104 data item is the SHA-256 of its signature (Verified 2026-11-07, ANS-104 spec: "The id of the DataItem, is the SHA256 digest of this signature"). An Arweave RSA-PSS key uses a random salt, so uploading the same bytes twice yields two IDs. A secp256k1 signer with deterministic ECDSA (RFC 6979) would yield the same ID for the same bytes and tags, which makes upload retries idempotent by construction and makes the ID known before upload. Three checks before choosing it:

1. Whether the Turbo SDK adds a random `anchor` by default. Partly checked on 2026-11-08: `@ardrive/turbo-sdk` 2.1.2 only passes an `anchor` when `dataItemOpts` provides one (`lib/esm/node/signer.js`); whether the underlying data-item library adds one is still open. The anchor is optional and up to 32 bytes (Verified 2026-11-07, ANS-104 spec); a random one would break determinism.
2. What Turbo does with an ID that already exists (rejects, or charges again).
3. That the signing library is actually RFC 6979 deterministic.

If any check fails, keep the Arweave key: the leaf already pins the canonical copy through `postArweaveId` (ADR-014), so duplicate uploads are harmless, only wasteful.

**Answer to "better than Arweave?"** Only cheaper options exist, and every one of them gives up permanence (term storage, pinning that someone must keep paying, or pruned data availability). For social content whose on-chain anchor is permanent, an anchor that outlives its data is a broken link, so this design keeps permanence.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Arweave direct L1 transaction | No bundler dependency | Needs AR, one Arweave tx per item, low throughput, slower confirmation | Turbo gives the same permanence with batching and fiat or USDC payment |
| Irys L1 | Fast uploads, programmable data | No longer a plain Arweave bundler: its own L1 datachain with permanent and term storage (Verified 2026-11-06: https://iq.wiki/zh/wiki/irys); ar.io removed the Irys bundler from the trusted bundler set of the main gateway (Verified 2026-11-06: https://www.techflowpost.com/en-US/article/15092) | Young chain, not Arweave; a different permanence model to trust |
| IPFS + pinning | Mature tooling, content addressing | Recurring cost; content disappears when nobody pins it | Not permanent |
| Filecoin | Cheap, verifiable storage deals | Term deals that must be renewed | Not permanent |
| Walrus | Fixed price of USD 0.023 per GB per month, term-based (epochs), about 5x erasure-coding expansion (Verified 2026-11-06: https://mystenlabs.github.io/walrus/pr-preview/pr-3439/docs/system-overview/storage-costs) | Term-based: someone must keep renewing | Cheaper for decades (see Evidence), but breaks permanence |
| DA layers / Ethereum blobs | Cheap, Ethereum-native | Blobs are pruned after about 18 days: data availability, not storage | Data disappears |
| Caption on-chain + image on Arweave (hybrid) | Caption readable from chain state | On-chain cost grows with text length (ADR-004: about 22k gas per 32-byte storage word) and is paid on every chosen chain | Cost grows with content; no benefit for verification, which already commits to the caption through the post hash |

## Consequences

Positive:

- Permanent, content-addressed storage without recurring payments; posts survive the platform.
- One owner key for all uploads: no per-user enumeration through the owner field.
- Payment in fiat or USDC; no AR treasury management.

Negative:

- Trust in Turbo to settle data items to Arweave after making them readable (ADR-008 trust assumption).
- **The free tier covers the PoC, not production.** It is a 10 MiB lifetime allowance per wallet and per subnet, and the platform uploads everything with one key, so in production storage is paid at list price after about 107 images (Estimate: 10 MiB / 95 KiB = 10,240 / 95 = 107.8). Cost risk is tracked in ADR-018.
- Permanent storage of user content creates moderation and GDPR obligations (ADR-018).

Follow-ups:

- Decide the platform signer key type after the three checks above.
- Record the Turbo price on the date of each benchmark run (the price is dynamic).

## Evidence

- Turbo price: https://turbo.ardrive.io/v1/rates returned USD 73.51 and `winc` 14986793268274; the unit is inferred to be 1 GiB because https://turbo.ardrive.io/v1/price/bytes/1073741824 returned the same `winc` (Verified 2026-11-06). Derived: about USD 0.00007 per KiB (Estimate: 73.51 / 1,048,576 = 0.0000701).
- Turbo free tier: "Items up to 105 KiB are eligible for the free tier, subject to a 10 MiB lifetime allowance tracked per-wallet and per-subnet" (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/; also "Free uploads under 105 KiB" on https://docs.ar.io/build/upload/). **Stale fact corrected:** the research notes of 2026-11-06 recorded "data items under 100 KiB are free" from https://docs.ardrive.io/docs/turbo/credits, which returned 404 on 2026-11-07. The image target of about 95 KiB (ADR-003) stays under both thresholds.
- Walrus vs Arweave over time: Arweave costs about USD 68.5 per GB once (Estimate: 73.51 / 1.0737 GB per GiB); Walrus at USD 0.023 per GB per month reaches that after about 2,977 months, about 248 years (Estimate: 68.5 / 0.023). If the Walrus price applies to the encoded size (about 5x), that drops to about 50 years. Which size the price applies to: To verify.
- Ethereum blob retention: about 18 days (Estimate: 4096 epochs x 32 slots x 12 s = 1,572,864 s = 18.2 days; the 4096-epoch retention parameter To verify against the consensus specs).
- Turbo price on 2026-11-07: USD 71.41 per GiB plus a flat fee per data item of 6,275,347 winc (USD 0.0000308), from https://turbo.ardrive.io/v1/rates (`perDataItemFeeWinc`); the price of a 95 KiB item, USD 0.00650, matches `/v1/price/bytes/97280` fee included (Verified 2026-11-07 by `node packages/bench/src/cost-snapshot.mjs`).
- First real upload (2026-11-08, platform RSA key): Turbo reported the post JSON `CONFIRMED` at once with a cost of 0 winc (free tier), but `arweave.net` served it only about 6 minutes after the upload (first served between 20:00:29 and 20:00:49 UTC for an upload at 19:54:57 UTC, polled every 20 s). The signed data item was 1,711 bytes for a 510-byte payload: about 1.2 KB of ANS-104 headers (RSA owner and signature, tags), which bounds the effect on the 105 KiB threshold for the 95 KiB image cap.
- To verify: whether ANS-104 headers and tags count toward the 105 KiB free-tier threshold; the three signer key checks above; Turbo upload rate limits (ADR-010).
