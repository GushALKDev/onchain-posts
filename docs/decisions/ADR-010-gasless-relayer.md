# ADR-010: Gasless submission through a platform relayer

Status: Accepted
Confidence: High
Reversibility: Reversible
Date: 2026-11-07
Updated: 2026-11-09

## Context

The founder was explicit about cost to the user: "instead of making people pay to post content on-chain, we need to find a way to make it gasless". Added requirement A1 adds a second constraint: "The user's address or public key never appears on-chain, on Arweave, or to other users."

Every EVM transaction has a sender. Whatever mechanism makes posting gasless also decides which address appears as `msg.sender` (or as the account in a UserOperation) on each chain. Most standard gasless patterns keep the user as the logical sender, which is exactly what A1 forbids.

Batching ([ADR-006](ADR-006-batching-policy.md)) changes the economics as well: the on-chain work is one transaction per batch and chain, not one per post, so the mechanism must allow many users' posts to share one transaction.

## Decision

The platform relayer sends every transaction. The user never sends a transaction and never pays gas: they only sign a `PublishIntent` off-chain with EIP-712 ([ADR-012](ADR-012-signature-scheme-eip712.md)).

- On-chain, the only sender is a platform relayer address, listed with role `relayer` per chain in `config/trusted-keys.json` ([ADR-009](ADR-009-anchor-contract.md)).
- The backend verifies the user's signature off-chain ([ADR-011](ADR-011-identity-openfort.md) explains why it verifies the signer EOA), then the post joins the per-chain queues.
- The relayer anchors one Merkle root per batch and chain through `PostAnchor.anchor` ([ADR-005](ADR-005-commitment-merkle-tree.md), [ADR-009](ADR-009-anchor-contract.md)).
- The platform pays gas and storage ([ADR-018](ADR-018-abuse-cost-control.md) covers who pays and how cost is capped).

Centralisation is an accepted trade-off, consistent with the founder's platform-only account model. The mitigations are signed receipts ([ADR-015](ADR-015-signed-receipts.md)) and `sigCommit` ([ADR-013](ADR-013-author-privacy-sigcommit.md)). What they cover is stated once, in the words of ADR-015:

> Receipts make omission provable; sigCommit lets genuine authors prove authorship. Neither prevents the platform from fabricating posts: that requires the per-batch validity proof (future work).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Platform relayer, user signs an off-chain intent (chosen) | No user address on-chain; one tx per batch and chain amortised across all users; no account deployment; simplest infrastructure | Users trust the platform for liveness and for not fabricating posts; platform pays all gas | Chosen |
| ERC-2771 trusted forwarder | Standard meta-transaction pattern; user keeps on-chain authorship | `_msgSender()` is the user: the forwarder appends the user address to the calldata, so it is public in every forwarded transaction | Breaks A1 |
| ERC-4337 with a paymaster | Gas sponsored by paymaster policy; aligned with the founder's account abstraction direction | The UserOperation sender is the user's smart account address, visible on-chain; one UserOp per post per chain plus EntryPoint overhead; account deployment per chain | Breaks A1; no amortisation across users |
| User EIP-7702 delegation | EOA gains smart-account features without a new address | The transaction sender (or authority) is the user's EOA | Breaks A1 |
| "Sign once, execute on several chains" UserOps (multichain validators, for example Biconomy MEE / Supertransactions and the Safe Unified Account proposal) | One user signature authorises operations on several chains; on-chain verifiable authorship without trusting the platform | Same counterfactual account address exposed as sender on every chain; no amortisation across users (one UserOp per post per chain plus EntryPoint overhead); account deployment per chain; still needs bundler and paymaster infrastructure | Breaks A1 and costs more per post |

What the rejected account abstraction options would have gained: on-chain verifiable authorship. With a user-controlled sender, the chain itself would show that the user authorised the post, without trusting the platform. This design gives that up for A1 and for amortisation, and recover part of it off-chain with `sigCommit` (authorship provable on demand by the genuine author).

## Consequences

Positive:

- A1 holds at the transaction layer: only relayer addresses ever appear as senders.
- On-chain transactions scale with `chains x batches`, not with posts. With Nmax = 500 (design parameter, [ADR-006](ADR-006-batching-policy.md)) a full batch puts 500 posts in one transaction per chain.
- No smart account deployment per user per chain, no bundler, no paymaster for the posting flow.
- The user experience needs no wallet funding, no network switching and no gas prompts.

Negative:

- Trust in the platform: liveness (it may not anchor) and honesty (it may anchor posts nobody signed). Omission is made provable by receipts; fabrication is not prevented (see the quote above).
- The relayer is a single on-chain identity per chain: if its key is compromised, anchors made before detection stay on-chain and are excluded only by the revocation date in `config/trusted-keys.json` ([ADR-009](ADR-009-anchor-contract.md)).
- The platform pays all gas, which makes cost exhaustion a platform risk ([ADR-018](ADR-018-abuse-cost-control.md)).

Follow-ups:

- Availability: stateless API, Postgres as the queue, several replicas ([ADR-016](ADR-016-backend-architecture.md)).
- Future work: per-batch validity proof (ZK) so that "every leaf carries a valid signature of a registered user" no longer depends on trusting the relayer ([ADR-005](ADR-005-commitment-merkle-tree.md)).

### Bottleneck analysis

With batching, the on-chain side is no longer the bottleneck. The real constraints are elsewhere:

| Stage | Work per post | Bottleneck and handling |
| ----- | ------------- | ----------------------- |
| On-chain anchoring | None per post: one tx per batch and chain | Nonce serialisation per relayer key; handled by a local nonce manager and gas bumping ([ADR-008](ADR-008-multichain-orchestration.md)) |
| Turbo uploads | Two data items (image, post JSON) | Parallel storage workers; Turbo rate limits (To verify: published rate limits of the Turbo upload service) |
| Signature verification | One EIP-712 recovery | An EOA signature is pure CPU. An ERC-6492 signature of an undeployed smart account would need an `eth_call` per post: one more reason to verify the signer EOA ([ADR-011](ADR-011-identity-openfort.md)) |
| KMS signing | None per post | One signature per batch and chain, plus one receipt signature per post (receipt key, [ADR-015](ADR-015-signed-receipts.md)) |

Nonces are not a throughput cap: several pending transactions with consecutive nonces can be included in one block. They create ordering and head-of-line risk, handled in [ADR-008](ADR-008-multichain-orchestration.md).

## Evidence

- Founder quote on gasless posting: interview notes (brief context, section 1 of the exercise prompt).
- Biconomy: the page cited in the research notes (`https://docs.biconomy.io/Modules/multichain`) returned 404 on 2026-11-07. Current docs say that with MEE "your users sign once to execute operations across multiple chains" (Verified 2026-11-07: https://docs.biconomy.io/ and https://docs.biconomy.io/overview/abstractjs/cross-chain). The research notes described this as the user signing a Merkle root of UserOp hashes; the current pages do not describe the mechanism (To verify: how MEE commits to the per-chain operations under one signature).
- Safe Unified Account: forum proposal, "sign once for operations across multiple chains using Merkle proofs"; the post says separate transactions per chain are still needed, the demo runs on Sepolia only, a security audit is pending and mainnet adoption is not sought yet (Verified 2026-11-07: https://forum.safefoundation.org/t/safe-unified-account-one-signature-every-chain/6926). Treated as a proposal, not a product.
- Gas per batch and per post: see [ADR-001](ADR-001-efficiency-definition.md) (measured with the benchmark in `contracts/bench` and `packages/bench`).
- To verify: Turbo upload rate limits.
