# ADR-013: Author privacy and sigCommit

Status: Accepted
Confidence: High
Reversibility: One-way door (whatever is published on-chain or on Arweave is permanent)
Date: 2026-11-07

## Context

Added requirement A1 comes from the interview: the founder said users must be able to use the platform without revealing their public key or wallet address, and that other users must not see it. He said it about the "universal interface"; we apply it voluntarily to posting. Exact wording:

> The user's address or public key never appears on-chain, on Arweave, or to other users.

The tension: the platform wants authorship to be provable (a post really comes from the user), but the natural proof, the user's signature, reveals the public key through `ecrecover`.

## Decision

### What never appears publicly

The user's address, public key and signature never appear in: the transaction sender, events, calldata, the Arweave `owner` field, Arweave tags, or the post JSON.

- Transactions are sent by the platform relayer ([ADR-010](ADR-010-gasless-relayer.md)).
- Arweave data items are signed with a platform key ([ADR-002](ADR-002-storage-arweave-turbo.md)): the ANS-104 `owner` field is the signer's public key, and Arweave GraphQL can filter by owners.
- The signature is replaced by a commitment.

### sigCommit

`sigCommit = keccak256(signature)`, stored inside the leaf ([ADR-014](ADR-014-data-model.md)).

| Property | Detail |
| -------- | ------ |
| Authorship provable on demand | The author reveals the signature for one post together with the intent fields that are not public (`chainIds`, `nonce`, `deadline`); the `Post` fields come from the post JSON. Anyone checks that the signature hashes to `sigCommit`, that it recovers over the `PublishIntent` digest to the author's key, that the intent's `post` hashes to `postHash`, and that the leaf was anchored at time T, so the signature existed before T |
| Posts unlinkable | Each signature differs, so each `sigCommit` differs; nothing public links two posts of the same author except the username (public by design) |
| The proof cannot be produced for a post the user did not sign | A valid signature needs the user's key, so the platform cannot later produce an authorship proof for a post it anchored without one. This assumes the platform cannot sign for the user: it holds only with the recovery modes chosen in [ADR-011](ADR-011-identity-openfort.md) (passkey, password, or automatic with OTP), because in automatic recovery without OTP the developer backend can reconstruct the user's key. The platform does hold an encrypted copy of genuine signatures (below), so it can disclose a genuine proof; disclosure is logged |
| Cost | 0 extra gas (only the root goes on-chain); 32 bytes per manifest entry |
| No salt needed | A signature cannot be guessed without the key, so the hash does not leak it |
| ERC-6492 wrapped signatures | They contain factory calldata including the owner: hidden under the hash, revealed only on disclosure. The backend verifies the signer EOA signature anyway ([ADR-011](ADR-011-identity-openfort.md)) |

What `sigCommit` does NOT do: it does not stop the platform from anchoring a post under any username with a random `sigCommit`. In the words of [ADR-015](ADR-015-signed-receipts.md):

> Receipts make omission provable; sigCommit lets genuine authors prove authorship. Neither prevents the platform from fabricating posts: that requires the per-batch validity proof (future work).

### Who keeps the signature for disclosure

Both the client and the backend.

- Client: the web app stores each signature in IndexedDB, with the intent fields `chainIds`, `nonce` and `deadline` (without them the signed digest cannot be recomputed), keyed by `postHash` and bound to the logged-in Openfort user, and adds them to a private copy of the proof bundle ([ADR-014](ADR-014-data-model.md)).
- Backend: the signature is encrypted at rest with a key that lives OUTSIDE the database (KMS in production, the same Signer/KMS simulator interface in the PoC, [ADR-016](ADR-016-backend-architecture.md)). Reason: `ecrecover` on a stored signature yields the address, so a database dump without that key must not reveal addresses.

On-demand disclosure flow:

1. The authenticated user requests the signature of one of their posts.
2. The backend decrypts it with the external key.
3. It returns the signature, with the private intent fields needed to recompute the signed digest (`chainIds`, `nonce`, `deadline`), only to that user, over the authenticated session.
4. It records the disclosure (who, when, which `postHash`) in an audit log, before decrypting; the log entry is unique per signed request, so a replayed request is rejected.

The backend never decrypts for any other purpose.

### The database is the privacy boundary

The backend database holds the mapping user, signer address, posts. It is minimised and encrypted:

- Store `HMAC(signerAddress, DB_HMAC_SECRET)` instead of the address. A request is verified by `ecrecover`, then HMAC, then comparison. The secret lives outside the database.
- Combined with the encrypted-signature rule, a database dump alone does not reveal addresses.
- The address recovered in memory during verification is never written to logs, traces or error messages ([ADR-016](ADR-016-backend-architecture.md)).

## Alternatives considered

Options for author identity on a public, permanent medium:

| Option | What stays public | Who can attribute | Linkability | On-chain verifiable | Extra cost | Feasible in a week |
| ------ | ----------------- | ----------------- | ----------- | ------------------- | ---------- | ------------------ |
| I1 Custodial attribution (platform says who) | Username only | Platform | Platform only | No | None | Yes |
| I2 Opaque per-user ID | A stable pseudonymous ID per user | Platform | All posts of a user linkable by anyone | No | 32 B per post | Yes |
| I3 Per-post author commitment | A per-post commitment | Author (by opening it) | Unlinkable | Opening checkable off-chain | 32 B per post | Yes |
| I4 Private user signature | Nothing (kept private) | Author (by revealing it) | Unlinkable | Off-chain on disclosure | None on-chain | Yes |
| I5 Ephemeral per-post keys with platform co-signature | Ephemeral key per post | Author and platform | Unlinkable if keys are fresh | Yes (ephemeral sig) | Key management per post | Partly |
| I5b I5 with blind signatures | Ephemeral key, platform signature unlinkable to issuance | Author | Unlinkable even to the platform | Yes | Blind-signature scheme, more complex client | No |
| I6 ZK membership (Semaphore v4) | Proof of group membership | Nobody, unless the author reveals | Unlinkable within the anonymity set | Yes: `validateProof` about 285,622 gas for 10 members (Verified 2026-11-07, see Evidence) | High gas per proof | No |
| I7 Stealth-style derivation (ERC-5564) | Derived one-time address | Author | Unlinkable | Partly | Scheme targets receivers, not senders | No |
| I8 Per-user AA account as sender | The account address | Anyone | Fully linkable | Yes | UserOp per post per chain | Yes, but rejected |

Notes on the rejected options:

- I6: group root synchronisation across 3 chains is an open problem here; the anonymity set of a demo would be tiny; and the username in the content defeats the anonymity anyway.
- I7: ERC-5564 targets receivers of funds, not authors of messages.
- I8: exposes the address, breaks A1 ([ADR-010](ADR-010-gasless-relayer.md)).

Chosen: I4 plus an I3-style commitment (`sigCommit`), with the platform relayer as sender.

Alternative for signature custody: signature only in the client's proof bundle (no platform copy). Pros: the platform cannot be compelled to disclose it. Cons: losing the device or clearing site data loses the proof. Rejected for the PoC in favour of the encrypted platform copy; reversible.

## Consequences

Positive:

- The user address and signature appear nowhere public.
- Authorship of a genuine post can be proven by its author, unlinkably, at no gas cost.
- A database dump alone does not reveal addresses.

Negative:

- Fabrication is not prevented (see the quote above).
- The backend and Openfort are trusted with the user to address mapping.
- What an observer can still infer (residual inferences):
  - timing correlation across Arweave and the chains;
  - the chosen chain set as a fingerprint;
  - the same `postHash` on several chains (intended);
  - the username (public by design) and writing style;
  - image size;
  - IP addresses seen by the relayer API and by Turbo (Turbo sees the backend's IP, the API sees the user's);
  - Openfort can link email and address, and possibly posts ([ADR-011](ADR-011-identity-openfort.md), To verify).

Follow-ups:

- Open problem: users' own on-chain interactions in the universal interface (for example "42 verified interactions with Uniswap") need a privacy layer; not solved here.
- Future work: per-batch validity proof ([ADR-005](ADR-005-commitment-merkle-tree.md)).

## Evidence

- ANS-104: the data item `owner` field is "The public key of the owner" (Verified 2026-11-07: https://github.com/ArweaveTeam/arweave-standards/blob/master/ans/ANS-104.md). The cookbook URL used in the research notes (https://cookbook.ar.io/tooling/specs/ans/ANS-104.html) returned a 404 page on 2026-11-07, so the canonical spec is cited instead.
- Arweave GraphQL can filter by owners (`transactions(owners: [...])`) (Verified 2026-11-07: https://docs.ar.io/build/access/find-data/).
- Semaphore v4: "calling `validateProof` for 10 members has an estimated gas cost of 285622"; this is the Semaphore.sol (Circom, v4) figure on that page (Verified 2026-11-07: https://hashcloak.github.io/semaphore-noir-final-report/benchmarks.html).
- ERC-5564 lets senders "non-interactively generate private accounts exclusively accessible by their recipients": it protects receivers, not authors (Verified 2026-11-07: https://eips.ethereum.org/EIPS/eip-5564, text read from the ERCs repository).
- OpenSigner custody: 2 of 3 shares; the developer backend can reconstruct a key only in automatic recovery without OTP, which ADR-011 excludes (Verified 2026-11-07, sources in [ADR-011](ADR-011-identity-openfort.md)).
- To verify: whether Openfort sees `PublishIntent` payloads (signing happens in the iframe; payload transport not documented).
