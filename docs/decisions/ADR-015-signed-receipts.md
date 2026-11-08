# ADR-015: Signed receipts and censorship detection

Status: Accepted
Confidence: High
Reversibility: Reversible
Date: 2026-11-07

## Context

The relayer decides what gets anchored ([ADR-010](ADR-010-gasless-relayer.md)). Two risks follow:

- Omission: the platform accepts a post and then never anchors it on a chain the user chose (censorship, bug or outage).
- Fabrication: the platform anchors a post the user never signed.

Users also need fast feedback: anchoring can take up to Tmax plus inclusion time ([ADR-006](ADR-006-batching-policy.md)), and "Settled" takes minutes on the L2s ([ADR-017](ADR-017-confirmation-semantics.md)). A signed acknowledgement at acceptance time solves the UX and gives the user evidence to hold the platform to its word.

## Decision

After validation, and before the Arweave upload (for fast UX), the backend returns a `Receipt` signed with EIP-712 by a dedicated receipt key, separate from the relayer keys (key separation: compromising one does not compromise the other).

### Typed data (fixed, so no implementation invents it)

```
Domain:   { name: "Phi Receipts", version: "1" }
          (no chainId, no verifyingContract; deliberately different from the "Phi Posts" intent domain,
           so a receipt can never be mistaken for an intent or the reverse)

Receipt  { bytes32 postHash; bytes32 sigCommit; uint64 acceptedAt; Deadline[] deadlines }
Deadline { uint256 chainId; uint64 anchorBy }
```

- The receipt signer is recovered with `ecrecover` over `hashTypedData` and checked against an entry with role `receipt` in `config/trusted-keys.json` ([ADR-009](ADR-009-anchor-contract.md)).
- There is one `anchorBy` PER CHAIN, computed as in [ADR-006](ADR-006-batching-policy.md): storage stage budget (Turbo upload of image and post JSON) + that chain's Tmax + submission margin + inclusion margin. Reason: Tmax differs a lot between chains (30 s on the L2s, 300 s on Ethereum Sepolia, design parameters), and a single deadline would not identify which chain missed it.
- `anchorBy` refers to INCLUSION of the anchoring transaction ("Published", [ADR-017](ADR-017-confirmation-semantics.md)), not to "Settled": the platform controls when it submits, not when an L2 batch reaches L1.
- The storage stage is inside the budget on purpose: the receipt is issued before the upload, so a slow or failing Turbo is the platform's risk, not the user's.
- In DEMO_MODE the computation uses the demo Tmax, so demo receipts promise what demo mode delivers ([ADR-006](ADR-006-batching-policy.md)).
- The receipt reveals nothing about the user: it carries `sigCommit`, not the signature.
- The web app checks the receipt as soon as it arrives: signer listed with role `receipt`, `postHash` and `sigCommit` equal to its own values, one `Deadline` per chosen chain. A receipt that fails this check is reported to the user as not accepted.

### Verifiable without the backend

The receipt key's address, with its validity window, is listed with role `receipt` in `config/trusted-keys.json`. A verifier checks a receipt from that file alone: signer listed as `receipt`, and `acceptedAt` inside the key's `[validFrom, revokedAt)` window. This window check is a consistency check, not a bound on a compromised key (see the honest limit below).

### Proving omission: the bounded scan

If the post is not anchored on a chain before that chain's `anchorBy`, the receipt plus on-chain state prove the omission. Proving an absence cannot come from a hint: the `pending` list in `GET /proof/:postHash` is untrusted ([ADR-014](ADR-014-data-model.md)). The verifier establishes "omitted" only by the bounded scan:

1. For that chain, read every `BatchAnchored` event emitted by the trusted relayer addresses (role `relayer`, that `chainId`, window valid at the block timestamp) between `acceptedAt` and `anchorBy` plus a margin (design parameter).
2. For each event, fetch the manifest by `manifestId` from an Arweave gateway and rebuild its root.
3. Confirm that no manifest whose rebuilt root equals the event's `root` contains the `postHash`.

Because the window is bounded, the scan is manageable: a few blocks of events and a handful of manifests. If any manifest in the window cannot be fetched, or does not rebuild to its event root, the scan is incomplete: the verifier says which one and does not conclude "omitted".

Per-chain verdicts reported by the verifier:

| Verdict | Condition |
| ------- | --------- |
| Anchored | Leaf proven under a root anchored by a trusted relayer inside its key window; flagged late if the anchor timestamp is after `anchorBy` |
| Pending, inside deadline | Not found yet, `anchorBy` not passed |
| Deadline passed, not found in hints (not scanned) | `anchorBy` passed, no anchor in the hints, bounded scan not run or incomplete |
| Omitted | Bounded scan completed over every trusted `BatchAnchored` event in the window, and no manifest contains the `postHash` |

### Honest limit of receipts after a receipt key compromise

`acceptedAt` is declared by the signer, not by a chain. An attacker holding the receipt key can sign receipts with an `acceptedAt` before the revocation date, and they pass the trusted-keys window check. Consequence: every receipt signed by that key becomes disputable, including genuine ones. Revocation cannot bound it, and such receipts could be used to accuse the platform falsely of omitting posts that never existed.

A cheap mitigation exists and is documented as future work, not implemented: periodically anchor a hash of the receipts issued (for example a Merkle root of receipt hashes per hour) with a relayer key, so a genuine receipt can be shown to predate the compromise by a chain timestamp.

### What this does and does not cover

> Receipts make omission provable; sigCommit lets genuine authors prove authorship. Neither prevents the platform from fabricating posts: that requires the per-batch validity proof (future work).

A fabricated post under a real username with a random `sigCommit` is detectable only by its supposed author, who cannot prove a negative.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Signed receipt before upload, per-chain `anchorBy` (chosen) | Immediate "Accepted"; per-chain accountability; checkable from `config/trusted-keys.json` alone | Platform carries storage risk inside the deadline; receipt key is one more key to protect | Chosen |
| Receipt after the Arweave upload | Can include Arweave IDs | Slower UX (upload time before any feedback) | `postHash` already identifies the content; Arweave IDs come later in the proof bundle |
| Single `anchorBy` for all chains | Smaller receipt | Cannot tell which chain missed it; Tmax differs by an order of magnitude between chains | Loses per-chain accountability |
| `prevRoot` hash chain in the contract | Detects removal of a whole batch | Does not detect omission of a post inside a batch; head-of-line blocking between batches; extra storage ([ADR-009](ADR-009-anchor-contract.md)) | Receipts detect per-post omission instead |
| Receipt signed by the relayer key | One key less | Couples two roles; a relayer key compromise would also compromise receipts | Key separation |
| No receipt | Simplest | Omission unprovable; UX waits for anchoring | Fails the accountability goal |

## Consequences

Positive:

- "Accepted" is immediate; anchoring latency no longer drives UX.
- Omission on a given chain becomes provable from public data plus the receipt.
- Receipts reveal nothing about the user.

Negative:

- Fabrication is not prevented (see above).
- After a receipt key compromise, every receipt of that key becomes disputable, and revocation cannot bound it.
- The "omitted" verdict costs a bounded scan; without it the verifier can only say "deadline passed, not found in hints".

Follow-ups:

- Future work: periodic on-chain anchoring of receipt hashes (mitigation above).
- Future work: per-batch validity proof ([ADR-005](ADR-005-commitment-merkle-tree.md)).
- Retries of failed anchors must complete before `anchorBy` ([ADR-008](ADR-008-multichain-orchestration.md)).

## Evidence

- EIP-712 allows a domain with only some fields ("Protocol designers only need to include the fields that make sense for their signing domain") (Verified 2026-11-07: https://eips.ethereum.org/EIPS/eip-712).
- Implemented in `packages/verifier` with a default scan margin of 120 s after `anchorBy` (design parameter). Its integration tests (`packages/verifier/test/verify.test.ts`, local nodes with `PostAnchor` at its real address) cover each verdict: anchored (and late), pending, deadline passed but not scanned (scan not run, and an incomplete scan with a missing manifest), and omitted only after a complete bounded scan; plus a receipt from an untrusted key, whose deadlines are ignored.
- Receipt round-trip (sign and recover) is tested in `packages/core/test/eip712.test.ts`; signing with the KMS simulator comes with the backend.
- Tmax defaults: [ADR-006](ADR-006-batching-policy.md) (design parameters, tunable from the benchmark).
