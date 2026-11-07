# ADR-006: Batching policy

Status: Accepted
Confidence: High
Reversibility: Reversible (configuration per chain)
Date: 2026-11-07

## Context

ADR-004 and ADR-005 make the on-chain cost per batch constant, so the cost per post is C_tx / N. Larger batches are cheaper per post but make posts wait longer before anchoring. The user experience does not depend on anchoring: the signed receipt (ADR-015) gives "Accepted" immediately, and "Settled" takes minutes on L2s anyway (ADR-017).

## Decision

**One queue per chain.** Flush when **N >= Nmax** (default 500) **or** when the oldest queued post has waited **Tmax**.

| Chain | Tmax default | Nmax default |
| ----- | ------------ | ------------ |
| Base Sepolia | 30 s | 500 |
| Arbitrum Sepolia | 30 s | 500 |
| Ethereum Sepolia | 300 s (L1 is where each tx costs most) | 500 |

All values are design parameters, tunable per chain (`.env.example`) and to be tuned from the benchmark.

**Tmax is not tied to block time.** The receipt already decouples UX from anchoring, and "Settled" takes minutes on the L2s, so flushing every block only wastes transactions at low volume.

**Demo mode.** A `DEMO_MODE` setting with a short Tmax (for example 5 s, design parameter) or a "flush now" button in the web app, clearly labelled as demo behaviour, so "Published" appears quickly in the live demo. **Demo mode is not the efficiency configuration.** The flush-now endpoint costs one transaction per selected chain per call, so it is protected by `DEMO_FLUSH_TOKEN` and rate-limited even in demo mode (ADR-018).

**Receipt deadline per chain.** The receipt's `anchorBy` (ADR-015) is derived per chain as:

```
anchorBy = acceptedAt + storage stage budget (Turbo upload of image and post JSON)
                      + that chain's Tmax
                      + submission margin
                      + inclusion margin
```

It refers to **inclusion** ("Published", ADR-017), not to "Settled". In `DEMO_MODE` the computation uses the demo Tmax, so demo receipts promise what demo mode delivers (a receipt promising 300 s on Ethereum when the flush comes in 5 s would be misleading). The budget and margins are design parameters set when the backend is built.

**Model (Estimate).** With lambda = posts per second choosing that chain:

- N is about max(1, lambda x Tmax).
- On-chain cost per post is about C_tx / N.
- Added anchoring latency: Tmax / 2 on average, Tmax in the worst case.

At scale, Nmax is reached before Tmax and batching amortises a lot with negligible latency; the trade-off only matters at low volume, which is exactly where a longer Tmax helps.

### Worked example (Illustrative)

Base queue, Tmax = 30 s, Nmax = 500. All times and counts are Illustrative.

| Time | Event | Queue | Action |
| ---- | ----- | ----- | ------ |
| 0 s | Ana arrives | [Ana] | |
| 12 s | Bob arrives | [Ana, Bob] | |
| 25 s | Carla arrives | [Ana, Bob, Carla] | |
| 30 s | Ana has waited 30 s | | Flush: 1 tx with 3 posts |
| 60 s | Dani arrives alone | [Dani] | Dani already holds a receipt ("Accepted") |
| 90 s | Dani has waited 30 s | | Flush: 1 tx with 1 post (no saving, only a 30 s wait) |
| Peak | 500 posts arrive in 5 s | 500 posts | Nmax reached: immediate flush |

The same timeline in `DEMO_MODE` (Tmax = 5 s): Ana flushes alone at 5 s, Bob alone at 17 s, Carla alone at 30 s. Worse amortisation, faster "Published". That is why demo mode is not the efficiency configuration.

### Limits and throughput

- **N has no hard on-chain limit**: the root is constant size.
- **The manifest grows with N**: about 209 B per entry in JSON with hex (Estimate: 3 hex strings of 66 characters + 2 quotes each = 204, plus commas and brackets). At Nmax = 500 the manifest is about 105 KB (Estimate: 500 x 209 = 104,500 B plus a short header), just under the 105 KiB free-tier item size (107,520 B). Because the free tier is a 10 MiB lifetime allowance (ADR-002), the realistic cost is list price: about USD 0.007 per 500-entry manifest (Estimate: 102 KiB x USD 0.0000701), about USD 0.000014 per post. Cents, not a limit.
- **The nonce is not a throughput cap**: several pending transactions with consecutive nonces can land in one block. It creates ordering and head-of-line risk, handled by a local nonce manager and gas bumping (ADR-008).

**Block times, for context on the lower bound of Tmax:**

- Base: 200 ms canonical blocks since the Denim upgrade, activated on Base Sepolia on 2026-10-21 and on Base mainnet on 2026-11-05 at 18:00 UTC; Base stopped producing Flashblocks at activation (Verified 2026-11-07: https://docs.base.org/base-chain/flashblocks/faq.md and https://cryptobriefing.com/base-denim-200ms-block-times-mainnet/).
- Arbitrum: no fixed block time; the sequencer's default minimum delay between blocks is 250 ms (Verified 2026-11-07: https://docs.arbitrum.io/how-arbitrum-works/deep-dives/sequencer-transaction-flow).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Flush every block | Lowest anchoring latency | At low volume, one tx per post; latency gain invisible behind receipts and Settled | Wastes transactions |
| Size-only trigger (Nmax) | Maximum amortisation | Unbounded wait at low volume; receipts could not state a deadline | Breaks the receipt deadline |
| Time-only trigger (Tmax) | Predictable latency | A burst produces huge batches and a large manifest | Nmax caps the manifest |
| One global queue for all chains | One batch per flush | Chains have different costs and latencies; one slow chain delays the others | Per-chain independence (ADR-008) |
| Adaptive Tmax from load | Better amortisation | More moving parts to verify | Possible later, after the benchmark |

## Consequences

Positive:

- Cost per post falls as volume grows, with bounded latency at low volume.
- Each receipt can promise a concrete per-chain deadline.

Negative:

- At low volume, posts wait up to Tmax before anchoring (30 s on the L2s, 300 s on Ethereum, design parameters).

Follow-ups:

- Tune Tmax and Nmax per chain from the benchmark.
- Fix the storage budget and the margins used in `anchorBy`.

## Evidence

- **Stale fact corrected:** the research notes described Base as "2 s blocks with 200 ms Flashblocks preconfirmations" and the Denim mainnet activation as "targeted for November 2026". As of 2026-11-07 the Base docs state that Denim activated on mainnet on 2026-11-05 and that Flashblocks were discontinued.
- Manifest size and cost: Estimates above; Turbo price in ADR-002.
