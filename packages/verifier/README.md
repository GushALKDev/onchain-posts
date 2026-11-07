# @phi/verifier

A browser-compatible library (fetch + viem) with a thin CLI on top. Verifies a post using only public sources: an Arweave gateway, public RPCs and `config/trusted-keys.json`. The web Verify page and the CLI run the same library code.

Not implemented yet.

## Responsibilities

- Accept untrusted hints (a proof bundle file or `GET /proof/:postHash`) and re-derive and re-check everything; hints only save discovery time.
- Fallback discovery without hints: scan `BatchAnchored` events of trusted relayers and fetch manifests until the `postHash` is found.
- Fetch the post JSON and the image by Arweave ID; recompute `imageHash` and `postHash`; rebuild the Merkle root from the manifest and check the proof.
- Check `anchoredAt` / `verifyPost` on each chain for a sender listed with role `relayer` in `config/trusted-keys.json`, with the anchor timestamp inside that key's validity window.
- Verify the receipt ("Phi Receipts" EIP-712 domain) against a role `receipt` key in the same file and compare each chain with its `anchorBy`.
- Report per chain: anchored, pending inside deadline, deadline passed but not scanned, or omitted. "Omitted" is reported only after the bounded event scan completes (ADR-015), never from hints alone.

## Rules

- Must never import `@phi/backend`.
- Independent verification means running this CLI from the public repository at a pinned commit, or with a `trusted-keys.json` the user supplies.

## Planned usage

```
pnpm verify <postHash> [--hints <bundle.json>]
```
