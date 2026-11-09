# Threat model

Scope: the posting flow (compose, sign, accept, store, batch, anchor, verify) on Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia. Decisions referenced here are in [docs/decisions](decisions/). Number labels follow the repository convention (Verified, Estimate, To verify, Illustrative).

The one sentence that defines what the accountability mechanisms cover, used verbatim everywhere in this repository:

> Receipts make omission provable; sigCommit lets genuine authors prove authorship. Neither prevents the platform from fabricating posts: that requires the per-batch validity proof (future work).

## Assets

| Asset | Why it matters |
| ----- | -------------- |
| User address and public key | A1: must never appear on-chain, on Arweave, or to other users ([ADR-013](decisions/ADR-013-author-privacy-sigcommit.md)) |
| User signatures | `ecrecover` on a signature yields the address; they are also the author's proof of authorship |
| User to signer-address mapping | The privacy boundary held by the backend database |
| Integrity of published posts | A post on-chain must match what its author signed |
| Completeness of anchoring | Every accepted post must be anchored on every chosen chain before its `anchorBy` |
| Relayer keys | Their anchors are what verifiers trust |
| Receipt key | Its receipts are the user's evidence against omission |
| Arweave data-item key | Signs every upload; also a cost lever (uploads are paid by the platform) |
| Platform budget (gas, Turbo credits) | Cost exhaustion is a real attack on a gasless, permanent-storage platform |
| `config/trusted-keys.json` | The trust root of independent verification |

## Actors

- Chain observer: anyone reading the three chains.
- Arweave reader: anyone reading Arweave through a gateway or GraphQL.
- Turbo: the bundler that receives uploads from the backend.
- Openfort: the embedded account provider used for login and signing.
- Platform / relayer: the backend, its operators and its keys.
- Other users: people using the web app.
- External attacker: anyone else, including someone who steals a key or a database dump.

## What each actor sees

| Actor | Sees | Does not see |
| ----- | ---- | ------------ |
| Chain observer | Relayer address (tx sender), `root`, `manifestId`, `count`, block timestamp | User address, signature, content |
| Arweave reader | Image, post JSON (with username and caption), manifest (`postHash`, `postArweaveId`, `sigCommit` per post); `owner` = platform key; tags without username | User address, public key, signature |
| Turbo | Upload contents and tags; IP of the backend | User IPs, user addresses |
| Openfort | Email and account address. Signing happens inside the OpenSigner iframe; Openfort does not document whether the `PublishIntent` payload reaches its servers, and in a recorded run on 2026-11-08 no request or WebSocket frame to Openfort carried it ([ADR-011](decisions/ADR-011-identity-openfort.md)). Worst case: the only third party able to link email, address and posts | Posts, as long as the SDK keeps the payload client-side (observed, not guaranteed) |
| Platform / relayer | Everything: user to signer mapping (stored as HMAC), encrypted signatures, IPs at the API, all content | Plaintext addresses in a database dump without `DB_HMAC_SECRET` and the signature encryption key |
| The user's own browser | The user's signatures and intent fields in IndexedDB | Other users' data |
| Other users | Username and content | Addresses and signatures |

The user's address and signature appear nowhere public.

## Trust roots

| Trust root | What it anchors | Revocation |
| ---------- | --------------- | ---------- |
| `config/trusted-keys.json` | Relayer addresses per chain (role `relayer`) and receipt key addresses (role `receipt`, which sign receipts under the EIP-712 "Onchain Receipts" domain), each with `validFrom` and `revokedAt` ([ADR-009](decisions/ADR-009-anchor-contract.md), [ADR-015](decisions/ADR-015-signed-receipts.md)) | Off-chain only: set `revokedAt`. The contract has no admin. For relayer entries the window is compared with `block.timestamp`, set by the chain; for receipt entries it is compared with the self-declared `acceptedAt` (consistency check only, see receipt key compromise below) |
| Openfort key custody | That only the user can sign with the embedded account | OpenSigner: 2 of 3 shares (device, hot, cold). Holds only with passkey, password or OTP-protected automatic recovery; automatic recovery without OTP lets the developer backend reconstruct the key, so it is excluded ([ADR-011](decisions/ADR-011-identity-openfort.md)) |

Independent verification means running the verifier CLI from the source repository at a pinned commit, or with a `trusted-keys.json` the user supplies. The Verify page in the web app is served by the platform together with its copy of the file, so it is a convenience, not independent verification.

## Trust assumptions

| Assumption | Mitigation or limit |
| ---------- | ------------------- |
| Relayer liveness and honesty | Receipts with per-chain `anchorBy` and `sigCommit` ([ADR-015](decisions/ADR-015-signed-receipts.md), [ADR-013](decisions/ADR-013-author-privacy-sigcommit.md)). What they cover: "Receipts make omission provable; sigCommit lets genuine authors prove authorship. Neither prevents the platform from fabricating posts: that requires the per-batch validity proof (future work)." |
| Turbo settles uploads to Arweave | Data is readable through Turbo before final Arweave settlement; anchoring before settlement trusts Turbo to settle ([ADR-008](decisions/ADR-008-multichain-orchestration.md)) |
| Manifests stay available on Arweave | Leaves are not emitted on-chain, so proof generation and the bounded scan depend on manifests ([ADR-005](decisions/ADR-005-commitment-merkle-tree.md)); `postArweaveId` in the leaf removes the indexer dependency for posts, not for manifests |
| Sequencer soft confirmations | "Published" on the L2s is the sequencer's word; rarely reverted; "Settled" waits for the safe head ([ADR-017](decisions/ADR-017-confirmation-semantics.md)) |
| Chain timestamps | Relayer key windows use `block.timestamp`. On Arbitrum it comes from the sequencer's clock, must be monotonic and within 24 hours earlier or 1 hour later than current time (Verified 2026-11-07: https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/block-numbers-and-time), so a revocation instant is only as precise as the sequencer's clock within that bound |
| Openfort key custody | The platform cannot sign for the user, given the recovery modes chosen in [ADR-011](decisions/ADR-011-identity-openfort.md); authorship proofs rest on it |

## Threats and mitigations

| Threat | Mitigation | Residual risk |
| ------ | ---------- | ------------- |
| Forged posts (the platform anchors a post the user never signed) | NOT prevented. A fabricated post under a real username with a random `sigCommit` is detectable only by its supposed author, who cannot prove a negative. Future work: per-batch validity proof ([ADR-005](decisions/ADR-005-commitment-merkle-tree.md)) | Full: users trust the platform not to fabricate |
| Censorship / omission (accepted post never anchored on a chosen chain) | Receipt with one `anchorBy` per chain; the verifier proves omission with the bounded scan of trusted `BatchAnchored` events and their manifests ([ADR-015](decisions/ADR-015-signed-receipts.md)) | Provable after the fact, not prevented |
| False omission claims | An "omitted" verdict needs the completed bounded event scan, never hints alone; the `pending` list from `GET /proof` is untrusted ([ADR-014](decisions/ADR-014-data-model.md)) | See receipt key compromise |
| Replay of a user signature | Never published (only `keccak256(signature)` is); nonce stored by the backend; `deadline`; domain and type match nothing else ([ADR-012](decisions/ADR-012-signature-scheme-eip712.md)) | A leaked signature within its deadline allows one acceptance only |
| Anchoring on a chain the user did not choose | `chainIds` signed and enforced by the backend; provable if the user reveals the signature; third parties can only anchor under their own address, which verifiers ignore | Detectable by the author only |
| Squatting or front-running anchors | Records are keyed by `msg.sender`; another sender's anchor of the same root lives under that sender and cannot block the relayer ([ADR-009](decisions/ADR-009-anchor-contract.md)) | Confusion ("anchored on Phi's contract"): every verification checks the trusted sender |
| Cost exhaustion | Per-user rate limits first, image size cap and rejection second, daily budget cap; flush-now protected by `DEMO_FLUSH_TOKEN` and rate-limited in demo mode ([ADR-018](decisions/ADR-018-abuse-cost-control.md)) | Sybil accounts can reach the daily cap (denial of service for honest users) |
| Username impersonation | The backend checks that the username belongs to the signer; restricted charset `[a-z0-9_]` and NFC normalisation verified, not applied ([ADR-012](decisions/ADR-012-signature-scheme-eip712.md)) | The platform itself (see forged posts) |
| EXIF / XMP leakage (GPS, device data) | The client strips metadata chunks before signing; the server rejects any WebP with a chunk outside the allowlist (in particular EXIF and XMP), using the same RIFF parser from `packages/core` ([ADR-003](decisions/ADR-003-arweave-layout-image-limits.md)) | Content of the image itself |
| Relayer key compromise | Off-chain revocation in `config/trusted-keys.json`; key rotation = new entry | Anchors made before detection stay on-chain and are excluded only by the revocation date |
| Receipt key compromise | Revocation in `config/trusted-keys.json` | `acceptedAt` is declared by the signer, not by a chain, so an attacker holding the key can sign receipts with an `acceptedAt` before the revocation date and they pass the window check. Every receipt signed by that key becomes disputable, including genuine ones; revocation cannot bound it, and such receipts could be used to accuse the platform falsely of omitting posts that never existed. Mitigation documented as future work: periodically anchor a hash of the receipts issued (for example a Merkle root of receipt hashes per hour) with a relayer key ([ADR-015](decisions/ADR-015-signed-receipts.md)) |
| Database breach | Signer addresses stored as `HMAC(signerAddress, DB_HMAC_SECRET)`; signatures encrypted with a key outside the database; recovered addresses never logged ([ADR-013](decisions/ADR-013-author-privacy-sigcommit.md), [ADR-016](decisions/ADR-016-backend-architecture.md)) | A breach that also reaches the external secrets reveals addresses |
| Browser storage breach | Signatures are stored only for the logged-in user | Locally stored signatures reveal the address behind that user's posts; clearing site data loses them (fallback: logged disclosure from the backend) |
| Arweave or gateway tampering | `postArweaveId` pinned in the leaf; downloaded bytes re-hashed against `imageHash` and `postHash` | Availability, not integrity |

## Residual inferences

Even with A1 met, an observer can infer:

- timing correlation between Arweave uploads and anchors on each chain;
- the chosen chain set as a fingerprint;
- the same `postHash` on several chains (intended);
- the username (public by design) and writing style;
- image size;
- IP addresses: the API sees the user's IP, Turbo sees the backend's IP;
- Openfort can link email and address; it could link posts only if its SDK sent it the payload, which a recorded run on 2026-11-08 did not show ([ADR-011](decisions/ADR-011-identity-openfort.md)).

## Out of scope

- Privacy of users' own on-chain interactions in the universal interface (open problem, [ADR-013](decisions/ADR-013-author-privacy-sigcommit.md)).
- The platform-lock co-signer ([ADR-011](decisions/ADR-011-identity-openfort.md)).
- Moderation and GDPR handling ([ADR-018](decisions/ADR-018-abuse-cost-control.md)).
- Network-level anonymity (Tor, mixnets) for API clients.
- Compromise of the user's device or Openfort account recovery flow.
- Non-EVM chains (Solana dropped for time, [ADR-007](decisions/ADR-007-chain-selection.md)).
