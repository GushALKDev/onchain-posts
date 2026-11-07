# ADR-011: Identity: Openfort embedded account as signing identity

Status: Accepted
Confidence: Medium
Reversibility: Reversible (with a migration cost: users would need to bind a new signing key to their username)
Date: 2026-11-07

## Context

Users must be able to post without installing a wallet or managing a seed phrase, and without their address being visible (A1). The founder's longer-term direction is account abstraction (he mentioned Dynamic and smart accounts) and accounts that are usable only on the platform.

Posting needs one thing from identity: a key that signs the EIP-712 `PublishIntent` ([ADR-012](ADR-012-signature-scheme-eip712.md)), so the backend can check that the username belongs to the signer and so the author can later prove authorship through `sigCommit` ([ADR-013](ADR-013-author-privacy-sigcommit.md)). It does not need the account to send transactions: the relayer does that ([ADR-010](ADR-010-gasless-relayer.md)).

## Decision

Users log in with email through Openfort. The embedded account is used ONLY as a signing identity in the posting flow.

- It never sends transactions here: if it did, its address would become the on-chain sender and break A1.
- The backend verifies the signature of the signer EOA, not of the smart account. This avoids ERC-1271 and ERC-6492 validation and the `eth_call` that an undeployed smart account signature would need per verification ([ADR-010](ADR-010-gasless-relayer.md), bottleneck analysis).
- The platform lock that the founder wants (accounts usable only on the platform) is documented below and NOT implemented.

Why Openfort and an embedded account:

- No wallet install, no seed phrase, recovery handled by the provider.
- Alignment with the founder's account abstraction direction: Openfort offers "Native ERC-4337 and ERC-7702 smart accounts with session keys and paymasters" (Verified 2026-11-07: https://www.quicknode.com/es/guia-para-constructores/herramientas/openfort-embedded-wallets-by-openfort), and its bundler and paymaster support EntryPoint v0.6, v0.8 and v0.9 (Verified 2026-11-06: https://www.openfort.io/docs/products/infrastructure).

### Openfort as a privacy actor

Openfort is an actor in the threat model ([threat model](../threat-model.md)), not a footnote:

- It knows the user's email and the account address.
- Whether it also sees every `PublishIntent` depends on whether the typed-data payload goes through Openfort's servers or stays inside the client-side signer iframe (To verify).
- In the worst case Openfort is the only third party able to link email, address and posts.

### Platform lock: documented, not implemented

| Mechanism | What it achieves | Limit |
| --------- | ---------------- | ----- |
| On-chain co-signer (2-of-2: user key + platform key), for example a Safe with two owners or a custom validator | Hard lock: no operation without the platform | Openfort docs checked on 2026-11-06 do not mention co-signer validation (To verify with Openfort) |
| EIP-7702 delegated EOA | Smart-account features on the user's EOA | Cannot be locked: the root key keeps full control of the EOA |
| OpenSigner key management | The key is split into shares (device, hot, cold) with Shamir's Secret Sharing | If any 2 of 3 shares reconstruct the key, device + recovery share rebuild it without the platform: a soft lock only. The threshold is To verify (see Evidence) |
| Login restricted to our domain | Users reach the account only through our app | Enforced by the provider's auth, not by the account |
| Paymaster policies | Limit what WE sponsor | Do not limit what the account can do; restricting the account needs session keys, permission modules or the co-signer |

### Fallback for an EIP-712 domain without chainId

The intent domain has no `chainId` ([ADR-012](ADR-012-signature-scheme-eip712.md)). If Openfort rejects such a domain, put a constant `chainId` in the domain as a namespace (for example Ethereum mainnet's, 1), identical on every chain. No contract ever verifies this signature, so any constant works and the replay analysis in ADR-012 does not change. This fallback is written here so that the To verify item cannot block the design.

One more point on the same fallback: some signers require the domain `chainId` to match the wallet's active chain (MetaMask does; Openfort: To verify). If Openfort does too, the fallback also requires switching the embedded account's active chain to the constant chain before signing. That is a UX step to document in the web app, not a design change.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Openfort embedded account (chosen) | Email login, recovery, AA roadmap (4337, 7702, session keys, paymasters) | Third party that knows email and address; possibly sees intents (To verify); several To verify items on EIP-712 handling | Chosen |
| Dynamic (the provider the founder mentioned) | Founder familiarity | Likely equivalent for this use (To verify); no time to evaluate both | Not evaluated in depth; the signing-only usage makes a later switch cheap |
| Embedded EOA (no smart account) | Same UX, simpler | No lock of any kind is possible | Gives up the AA direction for no gain in this flow |
| Device key or passkey without a provider | Fewer dependencies, no third party sees email | No recovery: losing the device loses the identity | Recovery matters for a consumer social product |

## Consequences

Positive:

- Users sign with a familiar email login; no gas, no wallet, no seed phrase.
- Signature verification is pure CPU (EOA `ecrecover`), with no RPC call per post.
- Because the account is used only to sign, swapping providers later changes the signing key, not the on-chain design.

Negative:

- Openfort is a privacy-relevant third party (email and address, possibly intents).
- The platform lock is not delivered; only its design space is documented.
- Authorship proofs rest on the assumption that the platform cannot sign for the user, which depends on OpenSigner custody (To verify; [ADR-013](ADR-013-author-privacy-sigcommit.md)).
- A provider change would require users to bind a new signing key to their username (migration cost).

Follow-ups:

- Verify the To verify items below before the backend implementation block.
- Future (out of scope): sponsored UserOps with paymaster policies and session keys for the universal interface. Hiding the sender address there needs a privacy layer: open problem ([ADR-013](ADR-013-author-privacy-sigcommit.md)).

## Evidence

- Openfort features (ERC-4337, ERC-7702, session keys, paymasters): Verified 2026-11-07: https://www.quicknode.com/es/guia-para-constructores/herramientas/openfort-embedded-wallets-by-openfort (the page is in English despite the `/es/` path).
- Openfort EntryPoint v0.6, v0.8, v0.9 support: Verified 2026-11-06: https://www.openfort.io/docs/products/infrastructure.
- Openfort docs checked on 2026-11-06 do not mention co-signer validation (To verify with Openfort).
- OpenSigner: the key is split into shares named device, hot and cold with Shamir's Secret Sharing; no threshold is stated (Verified 2026-11-07: https://github.com/openfort-xyz/opensigner). The "any 2 of 3 reconstruct the key" threshold appears only in a third-party evaluation that calls the third share "recovery" (https://capxul-docs.pages.dev/appendices/openfort-evaluation, checked 2026-11-07). The research notes stated the threshold as fact; it is downgraded here to To verify against Openfort's own documentation, and the soft-lock conclusion depends on it.

To verify (consolidated):

- That Openfort can sign EIP-712 typed data with a domain without `chainId`.
- Whether Openfort requires the domain `chainId` to match the active chain (only relevant for the fallback).
- How Openfort exposes the signer EOA signature (as opposed to a smart account signature).
- Where the typed-data payload travels (client-side iframe or Openfort servers).
- OpenSigner reconstruction threshold, and whether the platform alone can ever sign for the user.
- Whether Openfort supports an on-chain co-signer validator.
- Whether Dynamic is equivalent for this signing-only use.
