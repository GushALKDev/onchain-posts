# ADR-018: Abuse and cost control

Status: Accepted
Confidence: Medium
Reversibility: Reversible
Date: 2026-11-07

## Context

The platform pays for everything ([ADR-010](ADR-010-gasless-relayer.md)): gas on three chains and permanent storage on Arweave. Permanent storage cannot be undone, so an attacker who can make the platform upload data chooses how much the platform spends, forever. A public demo adds another spending surface: the flush-now button ([ADR-006](ADR-006-batching-policy.md)).

The Turbo subsidy is smaller than the research notes assumed. Turbo's free tier covers items up to 105 KiB, "subject to a 10 MiB lifetime allowance tracked per-wallet and per-subnet" (Verified 2026-11-07, see Evidence). The platform signs every upload with ONE platform Arweave key ([ADR-002](ADR-002-storage-arweave-turbo.md), required by A1), so the subsidy covers about 10 MiB in total, not every post: roughly 100 posts with a near-cap image (Estimate: 10,240 KiB / about 96 KiB per post for image plus post JSON). At any real volume, storage is paid at list price.

## Decision

Layered controls, in order of importance:

| Layer | Control | What it defends |
| ----- | ------- | --------------- |
| 1 | Per-user rate limits | Primary defence against cost exhaustion: bounds what one account can make the platform pay |
| 2 | Server-side validation ([ADR-003](ADR-003-arweave-layout-image-limits.md)): size, real MIME by magic bytes, absence of EXIF/XMP chunks, caption bytes, normalisation already applied | Malformed or oversized content never reaches storage |
| 3 | Client recompression, then rejection of images that still exceed the cap | Cost predictability per post; no pay-per-size escape hatch |
| 4 | Daily budget cap for gas and Turbo, with alerts | Bounds total spend if layers 1 to 3 are bypassed (for example many accounts) |

The image cap and the rejection rule stay even though the free tier no longer covers every post: their job is cost predictability and limiting what an attacker can make the platform store permanently, not staying inside the subsidy.

### Demo mode is a gas-spending surface

Every flush-now call is one transaction per selected chain. The endpoint is:

- protected by `DEMO_FLUSH_TOKEN` (or by an authenticated session);
- rate-limited (for example one flush per chain per minute, design parameter);
- counted against the daily gas budget like any other anchor;
- available only when `DEMO_MODE` is set.

A public demo with an unprotected flush button would let anyone drain the relayer.

### Public proof endpoint

`GET /proof/:postHash` is public and cheap. It is rate-limited per IP to protect the backend; it exposes only data that is already public (no signature, [ADR-014](ADR-014-data-model.md)).

### Moderation and legal

- Moderation before upload is required in production, because permanent storage also means permanent illegal content: documented, not implemented.
- GDPR tension between permanence and the right to erasure: documented as a risk. Mitigations: keep personal data off the permanent layer where possible (no `username` tag, no addresses, [ADR-014](ADR-014-data-model.md)); crypto-shredding for non-public content; gateway blocklists. Not legal advice.

### Who pays

The platform pays, as an acquisition cost. Future option: pay-per-use via x402 or stablecoins (Turbo itself accepts x402 payments in USDC on Base, [ADR-002](ADR-002-storage-arweave-turbo.md)).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Layered controls with rate limits first (chosen) | Bounds per-user and total spend; rejects early | Rate limits need tuning; a Sybil attacker with many accounts still reaches the daily cap | Chosen |
| Pay for oversized images | Better UX for large photos | The attacker chooses the volume of permanent storage the platform pays for | Cost exhaustion |
| Size cap only, no rate limits | Simple | Many small uploads still drain the budget | The cap is about predictability, not volume |
| Users pay per post (x402, stablecoins) | Aligns cost with use | Contradicts the gasless goal; payment flows could expose addresses (A1) | Future option only |
| Unprotected flush-now in demo mode | Easiest demo | Anyone can drain the relayer | Protected endpoint instead |

## Consequences

Positive:

- Spend per user and per day is bounded and observable.
- Demo mode cannot be used to drain the relayer without the token.

Negative:

- Dependency on the Turbo subsidy is a cost risk at scale, and the 10 MiB lifetime allowance per wallet makes it a small subsidy for a platform-signed model: list price is the realistic planning number ([ADR-001](ADR-001-efficiency-definition.md) reports storage both ways).
- A Sybil attacker can still hit the daily cap, which then becomes a denial of service for honest users; account creation cost (email login through Openfort, [ADR-011](ADR-011-identity-openfort.md)) is the only friction.
- No moderation pipeline in this delivery.

Follow-ups:

- Tune rate limits and the daily cap from benchmark costs.
- Moderation pipeline and GDPR handling: future work (README, Limitations).

## Evidence

- Turbo free tier: "Items up to 105 KiB are eligible for the free tier, subject to a 10 MiB lifetime allowance tracked per-wallet and per-subnet" (emphasis removed) (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/). The research notes recorded a 100 KiB threshold on 2026-11-06 (https://docs.ardrive.io/docs/turbo/credits, which returned 404 on 2026-11-07); the current ar.io page supersedes it.
- To verify: whether data item headers and tags count toward the free-tier size threshold.
- Cost per post at list price: [ADR-001](ADR-001-efficiency-definition.md) and [ADR-002](ADR-002-storage-arweave-turbo.md) (Estimates).
