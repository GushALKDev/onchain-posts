# ADR-017: Confirmation semantics

Status: Accepted
Confidence: High
Reversibility: Reversible
Date: 2026-11-07
Updated: 2026-11-09

## Context

"Published" means different things on an L1 and on a rollup, and the user sees one status per chain. The receipt's per-chain `anchorBy` ([ADR-015](ADR-015-signed-receipts.md)) needs a precise event to be measured against, and the web app needs labels whose meaning does not change between chains. The labels must also be honest about who is trusted at each stage (sequencer, L1 consensus).

## Decision

Three user-visible labels, with these meanings in the web app and in the docs:

| Label | Meaning | Who is trusted at this point |
| ----- | ------- | ---------------------------- |
| Accepted | Signed receipt issued (immediate) | The platform, held to its receipt ([ADR-015](ADR-015-signed-receipts.md)) |
| Published | Soft confirmation: the anchoring transaction is included in a block returned by the `latest` tag (on the L2s, the sequencer ordered it) | The sequencer's word on the L2s; one block of L1 consensus on Ethereum Sepolia |
| Settled | The block containing the anchor is at or below the chain's `safe` head | See the per-chain definition below |

`finalized` is tracked but not required for any label. The receipt's `anchorBy` is measured against "Published".

### "Settled" per chain type

| Chain | Definition of safe used here | Typical delay |
| ----- | ---------------------------- | ------------- |
| Arbitrum Sepolia (L2, Arbitrum Nitro) | The batch containing the block has been posted to the parent chain and reached the parent chain's `safe` block | Reference only: on Arbitrum One, safe about 13 minutes and finalized about 19 minutes behind head (third-party measurement, see Evidence; values vary) |
| Base Sepolia (L2) | The L2 block is derived from batch data posted to L1 (exact definition of Base's `safe` tag: To verify) | To verify |
| Ethereum Sepolia (L1) | The block is covered by a justified checkpoint of the beacon chain | To verify |

The web app tooltip for "Settled" gives one definition for all chains: the chain's safe head covers the block, which on the L2s means the batch is on Ethereum and safe there.

### Base after the Denim upgrade

Base stopped producing Flashblocks at the Denim activation, which brought 200 ms canonical blocks; per Base's own documentation there are no preconfirmed receipts any more (Verified 2026-11-07, see Evidence). "Published" on Base therefore means inclusion in a canonical 200 ms block returned by `latest`, with no separate preconfirmation stage to model.

The general lesson stays: every read the tracker makes is tagged with the block tag that produced it (`latest`, `safe`, `finalized`), and a status never moves forward on a read whose tag does not justify it.

### Soft confirmations

Soft confirmations rely on the sequencer's word and are rarely reverted. That is acceptable for social content: a reverted soft confirmation means a re-anchor, handled by the tracker and the retry rules of [ADR-008](ADR-008-multichain-orchestration.md), not a loss of content (the data is already on Arweave).

### Interaction with batching

Because "Settled" is minutes away regardless of batching on the L2s, a Tmax of tens of seconds ([ADR-006](ADR-006-batching-policy.md)) does not change the user-visible settlement time in a meaningful way.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Accepted / Published / Settled, `anchorBy` against Published (chosen) | Honest per-stage status; the deadline refers to what the platform controls | Three labels to explain; per-chain definitions of Settled | Chosen |
| Single "Confirmed" label | Simplest UI | Hides which trust assumption is in force; means different things per chain | Misleading |
| Wait for `finalized` before showing anything | Strongest status | Tens of minutes on the L2s; the UX the receipt was designed to avoid | Too slow; `finalized` is tracked instead |
| `anchorBy` against Settled | Stronger promise | The platform does not control when an L2 batch reaches L1, so the deadline would depend on third parties | The receipt promises only what the platform controls |
| Model Base Flashblock preconfirmations as a fourth stage | Faster signal on Base | Flashblocks were discontinued at Denim | Stale; see Evidence |

## Consequences

Positive:

- Users see an immediate "Accepted", then per-chain progress with clear meanings.
- The receipt deadline measures something the platform controls.

Negative:

- "Settled" has different definitions per chain; the tooltip must say which.
- Soft confirmations can, rarely, be reverted on the L2s; the tracker must handle regressions from Published back to Submitted.

Follow-ups:

- Measure Published and Settled latency per chain in the benchmark (p50 and p95, [ADR-001](ADR-001-efficiency-definition.md)).
- Still open: the exact definition of Base's `safe` tag and the typical `safe` delay on Base and Ethereum Sepolia (To verify below). The tracker reads each node's `safe` tag as reported, so these affect the wording, not the pipeline.

## Evidence

- Arbitrum block tags (Verified 2026-11-07: https://docs.arbitrum.io/how-arbitrum-works/reference/finality-and-reorgs): `latest`: "The Sequencer has ordered and executed the transaction and emitted it on the Sequencer feed"; `safe`: "The batch containing the block has been posted to the parent chain and reached the parent chain's `safe` block"; `finalized`: same with the parent chain's `finalized` block.
- Arbitrum One safe about 13 minutes (3,022 blocks) and finalized about 19 minutes (4,480 blocks) behind head: third-party measurement by the page author, page checked 2026-11-07 (https://dev.to/swiftnodes/arbitrum-rpc-a-developers-guide-chain-id-42161-250ms-blocks-fake-gas-limit-57gc). Not an official figure; values vary.
- Base Denim: "Base stopped producing Flashblocks on both networks at activation", mainnet activation "November 5, 2026 at 18:00 UTC", 200 ms canonical blocks, "there are no preconfirmed receipts" (Verified 2026-11-07: https://docs.base.org/base-chain/flashblocks/faq.md). Denim activated on Base Sepolia on 2026-10-21 (Verified 2026-11-07: https://cryptobriefing.com/base-denim-200ms-block-times-mainnet/; the same article still describes mainnet as "targeted for November 2026", which Base's docs supersede).
- Stale input corrected here: the research notes said a Base receipt can exist from a Flashblock preconfirmation before the block seals (citing https://www.dwellir.com/blog/base-flashblocks-for-rpc-operators). On 2026-11-07 that page did not support the receipt claim, and Base's documentation says Flashblocks and preconfirmed receipts are gone. Only the general point, that clients must label which state produced a read, is kept.
- To verify: exact definition of Base's `safe` tag and its typical delay; typical delay of the `safe` head on Ethereum Sepolia.
