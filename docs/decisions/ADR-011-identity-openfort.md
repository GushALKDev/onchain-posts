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
- **Account type for the PoC: EOA** (`accountType: AccountTypeEnum.EOA`, Openfort's default). Openfort documents that smart and delegated accounts sign with EIP-1271 verification, and does not document a way to obtain the owner EOA signature from them. With an EOA, `signTypedData` returns a plain ECDSA signature, so the backend verifies it with `ecrecover`: no ERC-1271 or ERC-6492 validation and no `eth_call` per verification ([ADR-010](ADR-010-gasless-relayer.md), bottleneck analysis). Smart accounts stay the path for the future universal interface, not for posting.
- **Recovery mode: passkey, password, or automatic recovery with OTP.** Openfort's OpenSigner docs state that in automatic recovery without OTP the developer backend can reconstruct a user's private key. That would let the platform sign for the user and void the authorship property of `sigCommit` ([ADR-013](ADR-013-author-privacy-sigcommit.md)), so that mode is excluded.
- The platform lock that the founder wants (accounts usable only on the platform) is documented below and NOT implemented.

Why Openfort and an embedded account:

- No wallet install, no seed phrase, recovery handled by the provider.
- Alignment with the founder's account abstraction direction: Openfort offers "Native ERC-4337 and ERC-7702 smart accounts with session keys and paymasters" (Verified 2026-11-07: https://www.quicknode.com/es/guia-para-constructores/herramientas/openfort-embedded-wallets-by-openfort), and its bundler and paymaster support EntryPoint v0.6, v0.8 and v0.9 (Verified 2026-11-06: https://www.openfort.io/docs/products/infrastructure).

### Openfort as a privacy actor

Openfort is an actor in the threat model ([threat model](../threat-model.md)), not a footnote:

- It knows the user's email and the account address.
- Signing happens inside the OpenSigner iframe: "All signing operations happen inside the iFrame. The private key is never exposed to the host application or any external service" (Verified 2026-11-07, see Evidence). The iframe fetches key shares from Openfort's hot storage and Shield; whether the typed-data payload itself is sent to Openfort's servers is not documented. Observed on 2026-11-08 (see Evidence): while signing, no HTTP request or WebSocket frame to Openfort carried the payload.
- In the worst case Openfort is the only third party able to link email, address and posts.

### Platform lock: documented, not implemented

| Mechanism | What it achieves | Limit |
| --------- | ---------------- | ----- |
| On-chain co-signer (2-of-2: user key + platform key), for example a Safe with two owners or a custom validator | Hard lock: no operation without the platform | Not documented by Openfort (docs checked 2026-11-06 and 2026-11-07); would need a custom smart account |
| EIP-7702 delegated EOA | Smart-account features on the user's EOA | Cannot be locked: the root key keeps full control of the EOA |
| OpenSigner key management | The key is split into 3 Shamir shares (device, hot, cold); "You need 2 of 3 shares" (Verified 2026-11-07) | Device + cold share rebuild the key without the platform: a soft lock only |
| Allowed domains per publishable key | Only our origins can use the embedded wallet ("restrict which web origins and native apps can use your publishable key", Verified 2026-11-07) | Enforced by the provider for our publishable key, not by the account; an exported key works anywhere |
| Paymaster policies and session keys | Limit what WE sponsor; session keys (EIP-7715) restrict permissions by contract, expiry and call limit | Policies do not limit what the account can do; session keys exist only for smart and delegated accounts, not for the EOA chosen above |

### Fallback for an EIP-712 domain without chainId

The intent domain has no `chainId` ([ADR-012](ADR-012-signature-scheme-eip712.md)). Openfort documents `signTypedData({ domain, types, message, primaryType })` for Ethereum embedded wallets, and its sample code says "Use the connected wallet's chain ID so the domain matches the active chain" (Verified 2026-11-07). Whether a domain without `chainId` is accepted is not documented. Tested on 2026-11-08: `embeddedWallet.signTypedData` signs the chain-agnostic domain as given (see Evidence), so the fallback below is not needed with this SDK version.

If Openfort rejects such a domain, put a constant `chainId` in the domain as a namespace, identical on every chain. Because the docs point at matching the active chain, the constant is chosen among the chains the embedded wallet is configured for, and the wallet is switched to it before signing if needed. No contract ever verifies this signature, so any constant works and the replay analysis in ADR-012 does not change. This fallback is written here so that the open item cannot block the design.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Openfort embedded account (chosen) | Email login, recovery, AA roadmap (4337, 7702, session keys, paymasters) | Third party that knows email and address; possibly sees intents (To verify); several To verify items on EIP-712 handling | Chosen |
| Dynamic (the provider the founder mentioned) | Founder familiarity | Likely equivalent for this use (To verify); no time to evaluate both | Not evaluated in depth; the signing-only usage makes a later switch cheap |
| Embedded smart account (ERC-4337 or EIP-7702) for posting | AA features, session keys | Signatures use EIP-1271; owner EOA signature retrieval not documented; ERC-1271 checks need an RPC call per post | EOA is enough for a signing-only identity; smart accounts are kept for the universal interface |
| Device key or passkey without a provider | Fewer dependencies, no third party sees email | No recovery: losing the device loses the identity | Recovery matters for a consumer social product |

## Consequences

Positive:

- Users sign with a familiar email login; no gas, no wallet, no seed phrase.
- Signature verification is pure CPU (EOA `ecrecover`), with no RPC call per post.
- Because the account is used only to sign, swapping providers later changes the signing key, not the on-chain design.

Negative:

- Openfort is a privacy-relevant third party (email and address, possibly intents).
- The platform lock is not delivered; only its design space is documented.
- Authorship proofs rest on the assumption that the platform cannot sign for the user. That holds only with the recovery modes chosen above (passkey, password, or automatic with OTP); automatic recovery without OTP would break it ([ADR-013](ADR-013-author-privacy-sigcommit.md)).
- A provider change would require users to bind a new signing key to their username (migration cost).

Follow-ups:

- Re-run both empirical checks below when the Openfort SDK is upgraded: they are observations of `@openfort/openfort-js` 2.6.4, not behaviour the provider documents or commits to.
- Future (out of scope): sponsored UserOps with paymaster policies and session keys for the universal interface. Hiding the sender address there needs a privacy layer: open problem ([ADR-013](ADR-013-author-privacy-sigcommit.md)).

## Evidence

- Openfort features (ERC-4337, ERC-7702, session keys, paymasters): Verified 2026-11-07: https://www.quicknode.com/es/guia-para-constructores/herramientas/openfort-embedded-wallets-by-openfort (the page is in English despite the `/es/` path).
- Openfort EntryPoint v0.6, v0.8, v0.9 support: Verified 2026-11-06: https://www.openfort.io/docs/products/infrastructure.
- Co-signer validation: not mentioned in Openfort's docs (checked 2026-11-06 and 2026-11-07).
- Typed-data signing: `signTypedData({ domain, types, message, primaryType })`, "Typed-data signing is available for Ethereum wallets. Use the connected wallet's chain ID so the domain matches the active chain." (Verified 2026-11-07: https://www.openfort.io/docs/products/embedded-wallet/react/wallet/actions/sign-message).
- Account types: "Smart and Delegated accounts use EIP-1271 verification" (same page); "By default, the Openfort SDK creates EOA (Externally Owned Account) wallets" and `accountType: AccountTypeEnum.EOA` (Verified 2026-11-07: https://www.openfort.io/docs/products/embedded-wallet/react/wallet/actions/session-keys, https://www.openfort.io/docs/products/embedded-wallet/account-types).
- Signing location: "All signing operations happen inside the iFrame. The private key is never exposed to the host application or any external service." (Verified 2026-11-07: https://opensigner.dev/actions/operation).
- Shares and threshold: Device Share, Hot Share, Cold Share, "You need 2 of 3 shares" (Verified 2026-11-07: https://opensigner.dev and https://github.com/openfort-xyz/opensigner). Openfort's product page names the shares device, auth and recovery with a "2-of-3 threshold" (https://www.openfort.io/docs/products/embedded-wallet/security/on-device), and describes automatic recovery as a 2-of-2 model between cold storage and a developer share: the docs are not fully consistent on naming.
- Platform reconstruction: the recovery-methods page says that in automatic recovery without OTP the backend can reconstruct a user's private key; with OTP, password or passkey recovery it cannot (Verified 2026-11-07: https://opensigner.dev/security/recovery-methods and https://opensigner.dev/security/deployment-scenarios).
- Allowed domains per publishable key (Verified 2026-11-07: https://www.openfort.io/docs/configuration/allowed-domains).
- Session keys (EIP-7715, `useGrantPermissions`) only for smart and delegated accounts (Verified 2026-11-07: https://www.openfort.io/docs/products/embedded-wallet/react/hooks/useGrantPermissions).
- Superseded: the third-party "2 of 3" claim (https://capxul-docs.pages.dev/appendices/openfort-evaluation) is now confirmed by Openfort's own OpenSigner docs.

Empirical checks (2026-11-08, `@openfort/openfort-js` 2.6.4, guest sign-in on the owner's Openfort project, headless Chrome against the local backend):

- **Domain without `chainId`: accepted.** `embeddedWallet.signTypedData(domain, types, message)` with the "Onchain Posts" domain (name, version, verifyingContract) returned a signature that recovers locally to the embedded EOA for exactly that payload, and the backend accepted the post after recovering the same signer.
- **The payload did not leave the iframe.** All network traffic of the page and its iframes was recorded while signing and submitting: Openfort received a `GET /iam/v2/auth/get-session` from the page and a `GET` plus `OPTIONS` of `/v1/devices/<id>` from the iframe, all without body; no URL or body contained the caption or the postHash; no WebSocket frame was sent (the only WebSocket was the local dev server). Only the backend's `POST /posts` carried the payload. This is one observation of the current SDK, not a provider commitment.
- The username ownership check held with real accounts: a second guest account posting with a username claimed by the first was rejected.

Still To verify:

- Whether Dynamic is equivalent for this signing-only use.
