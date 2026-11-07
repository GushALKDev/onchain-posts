# ADR-003: Arweave layout, image limits and rejection

Status: Accepted
Confidence: Medium
Reversibility: Reversible
Date: 2026-11-07

## Context

ADR-002 puts every byte on Arweave, paid by the platform and permanent. Two forces shape the layout: what is uploaded cannot be deleted (so the platform must control how much it pays for), and what the user signs freezes the bytes (ADR-012), so any transformation must happen before signing.

## Decision

**Three kinds of data items** (tags and schemas in ADR-014):

| # | Data item | Content | Uploaded |
| - | --------- | ------- | -------- |
| 1 | Image | Binary WebP, metadata stripped | Per post with an image, before the post JSON |
| 2 | Post JSON | `phi.post/1`, references the image by Arweave ID and hash | Per post |
| 3 | Batch manifest | `phi.manifest/1`, the leaves of one batch | One per batch and chain |

**Image limits.**

- Max side 1080 px, WebP (design parameters).
- Client-side recompression loop: lower the WebP quality step by step down to a minimum quality (design parameter, value set when the web app is built) until the file is at most **95 KiB** (design parameter). The margin keeps the item under Turbo's free-tier threshold of 105 KiB (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/). Whether ANS-104 headers and tags count toward that threshold: To verify.
- If it still does not fit: **reject**, in the PoC and in production.

**Why reject instead of paying.** Cost-exhaustion attack: an attacker uploading large images in a loop makes the platform pay for permanent storage that cannot be undone, and the attacker chooses the volume. Per-user rate limits (ADR-018) are the primary defence; the hard cap is mainly about **cost predictability**: it bounds the storage cost of one post at about USD 0.0067 at list price (Estimate: 95 KiB x USD 0.0000701 per KiB, ADR-002). The free tier no longer matters at scale because it is a 10 MiB lifetime allowance per wallet and per subnet (ADR-002), so the cap is what keeps the per-post cost known in advance.

**Caption limit.** 1,000 characters, counted as Unicode code points after NFC (design parameter). The server also validates the size in bytes: up to about 4 KB in UTF-8 (Estimate: 1,000 code points x at most 4 bytes each).

**The signed hash freezes the bytes** (key constraint, shared with ADR-012). `imageHash` and the caption are inside what the user signs, so the server cannot transform anything after signing: stripping EXIF or re-encoding would change the hash and invalidate the signature. Everything that enters the hash reaches its final form in the client, before signing:

1. EXIF and XMP removal, WebP re-encoding.
2. NFC normalisation of username and caption (username also lowercase, charset `[a-z0-9_]`).

The server only checks and rejects. For metadata this means parsing the RIFF chunks of the WebP. The RIFF chunk parser lives in `packages/core` and is used both by the client (to strip) and by the server (to detect), so the two sides cannot disagree on what counts as metadata. The server check is an **allowlist** of chunk types needed to render a still image (`VP8 `, `VP8L`, `VP8X`, `ALPH`): an `EXIF` or `XMP ` chunk is rejected, and so is any other chunk type (for example `ICCP` or animation chunks), which avoids a denylist that misses a new metadata carrier. The exact allowlist is fixed when `packages/core` is implemented.

**Server-side validation is mandatory** (never trust the client):

| Check | Rejects |
| ----- | ------- |
| Size | Image over 95 KiB, caption over 1,000 code points or its byte limit |
| Real MIME by magic bytes | Anything that is not `RIFF....WEBP`, whatever the declared Content-Type |
| Dimensions | Max side over 1080 px |
| Metadata chunks | Any chunk outside the allowlist, in particular `EXIF` and `XMP ` |
| Normalisation | Username or caption not already in NFC form, username outside `[a-z0-9_]` |
| Hashes | Recomputed `imageHash` or `postHash` different from the signed ones |

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Single JSON with the image in base64 | One data item per post | +33% bytes for the image (base64 expands 3 bytes to 4) | Pays permanent storage for encoding overhead |
| Nested ANS-104 bundle per post | One upload unit | More complex tooling for a gain we do not need | Complexity without benefit |
| Arweave path manifest per post | Human-friendly paths | One more data item per post | Extra cost; the post JSON already references the image |
| Pay for oversized images | Better UX for large photos | Attacker-controlled permanent cost; unpredictable cost per post | Cost exhaustion and unpredictability |
| Server-side stripping or re-encoding | Simpler client | Changes the bytes after signing, so the signature no longer matches | Not possible with a signed hash over the final bytes |
| Denylist of metadata chunks (EXIF, XMP only) | Exactly what the prompt names | Misses other carriers (ICC profiles can fingerprint a device; unknown chunks) | Allowlist is stricter at no cost |

## Consequences

Positive:

- Storage cost per post is bounded and known in advance.
- Client and server share one parser and one normaliser, so they cannot drift.
- A post is fully determined at signing time: what is stored is exactly what was signed.

Negative:

- Image quality is capped; some photos will be rejected and the user has to crop or reduce them.
- The client carries real work (re-encoding, parsing), which must run in the browser.

Follow-ups:

- Choose the minimum quality of the recompression loop with real photos.
- Confirm whether headers and tags count toward the free-tier size.

## Evidence

- Turbo free-tier threshold 105 KiB and 10 MiB lifetime allowance (Verified 2026-11-07: https://docs.ar.io/build/upload/turbo-credits/).
- Turbo list price and per-KiB derivation: ADR-002 Evidence.
- To verify: whether headers and tags count toward the size threshold; the final WebP chunk allowlist against the WebP container specification.
