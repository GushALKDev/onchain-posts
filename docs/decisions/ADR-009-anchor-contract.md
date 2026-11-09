# ADR-009: Anchor contract design

Status: Accepted
Confidence: High
Reversibility: One-way door (no proxy: the deployed contract is immutable; a change means a new deployment and a new address)
Date: 2026-11-07
Updated: 2026-11-09

Implemented in [`contracts/src/PostAnchor.sol`](../../contracts/src/PostAnchor.sol) with the repository's Solidity conventions (NatSpec, section headers); the logic is identical to the snippet below. Tests: [`contracts/test`](../../contracts/test).

## Context

ADR-004 puts one Merkle root per batch on-chain, ADR-005 makes it verifiable by contracts, ADR-008 needs on-chain rejection of duplicates, and requirement A1 forbids any user identity on-chain. The contract must be cheap per batch, trivial to audit, and identical on three chains.

## Decision

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4; // exact version pinned at implementation time

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract PostAnchor {
    error ZeroRoot();
    error AlreadyAnchored(bytes32 root, uint256 anchoredAt);

    // sender => root => anchoring timestamp (0 = not anchored)
    mapping(address => mapping(bytes32 => uint256)) public anchoredAt;

    event BatchAnchored(address indexed sender, bytes32 indexed root, bytes32 manifestId, uint32 count);

    function anchor(bytes32 root, bytes32 manifestId, uint32 count) external {
        if (root == bytes32(0)) revert ZeroRoot();
        if (anchoredAt[msg.sender][root] != 0) revert AlreadyAnchored(root, anchoredAt[msg.sender][root]);
        anchoredAt[msg.sender][root] = block.timestamp;
        emit BatchAnchored(msg.sender, root, manifestId, count);
    }

    function verifyPost(address sender, bytes32 root, bytes calldata leafData, bytes32[] calldata proof) external view returns (bool) {
        if (anchoredAt[sender][root] == 0) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(leafData)));
        return MerkleProof.verifyCalldata(proof, root, leaf); // OpenZeppelin
    }
}
```

### Decisions and reasons

**Permissionless, records keyed by `msg.sender`.** No owner and no admin functions. Key rotation = start using a new key; old anchors stay valid under the old address. Usable by any app.

- **Many writers are not a problem.** Records are isolated per sender; no shared counter and no loops; other writers pay for their own storage; the indexer filters by the indexed `sender` topic.
- **Front-running cannot block the relayer.** Anyone who copies a root from the mempool and anchors it first only creates a record under their own address; the platform relayer's `anchor` still succeeds. With a global `root => timestamp` mapping, the same front-run would make the relayer's transaction revert with `AlreadyAnchored` (root squatting).
- **Only risk: confusion** ("anchored on Phi's contract" by someone else). Every verification must include the trusted sender, and the UI shows it.

**Trusted platform keys are an explicit trust root, kept off-chain** in `config/trusted-keys.json`, versioned in the repo and read by the verifier. Without this file the verifier could only learn the receipt key from the backend, which would break the "untrusted hints" principle (ADR-014).

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `role` | `"relayer"` or `"receipt"` | What the key is trusted for |
| `chainId` | number, or `null` | Chain of a relayer entry; `null` for receipt entries, which are chain-agnostic because the receipt domain has no chainId (ADR-015) |
| `address` | address | The key's address |
| `validFrom` | ISO 8601 timestamp in UTC | Start of the validity window |
| `revokedAt` | ISO 8601 timestamp in UTC, or `null` | End of the validity window |
| `note` | string | Human description |

- **Relayer entries**: the window is compared with `block.timestamp` of the anchor (unix seconds, UTC), which the chain sets, not the key holder, so revocation excludes later anchors. On Arbitrum the timestamp comes from the sequencer's clock, must not decrease, and must lie between 24 hours earlier and 1 hour later than current time (Verified 2026-11-07: https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/block-numbers-and-time). A sequencer could therefore backdate within that range; the sequencer is already trusted for soft confirmations (ADR-017), and the exact bounds on Base are To verify.
- **Receipt entries**: the only timestamp available is the receipt's own `acceptedAt`, which the signer declares. A verifier checks that the signer is listed as a receipt key and that `acceptedAt` falls inside the window. That is a consistency check, **not a bound on a compromised key** (see ADR-015 for the limit).
- **Revocation of a compromised key is purely off-chain**: the contract has no admin. Anchors made by a compromised relayer key before detection remain on-chain and are excluded only by the revocation date. That is a documented limit.

**One storage slot per batch (`anchoredAt`).** It serves on-chain idempotency (ADR-008) and contract readability (`verifyPost`, any other contract can check an anchor). `manifestId` and `count` go only in the event, for off-chain consumers: storing `manifestId` would add another new slot, about 22k gas, almost +50% per batch (Estimate: 20,000 + 2,100 cold, on top of 47,058). The price of this one slot versus an event-only contract is 22,432 gas per batch (measured: ours minus ours-lite, ADR-001). `uint256` is used because the slot holds a single value: a smaller type would save nothing.

**`AlreadyAnchored` carries the root and the existing anchor time**, so a rejected duplicate explains itself in logs and traces (the repository convention is custom errors with parameters). The slot is re-read only on the revert path, so the success path costs exactly as without parameters: 47,058 gas (re-measured on 2026-11-08 with `node packages/bench/src/gas-bench.mjs`; keeping the first read in a local variable instead cost 5 gas more on every anchor).

**`block.timestamp` instead of `block.number`.** On Arbitrum, `block.number` returns "a value close to (but not necessarily exactly) the block number of the first non-Arbitrum ancestor chain" (Verified 2026-11-07: https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/block-numbers-and-time; the third-party page https://rpcfree.com/arbitrum-rpc says the same). A timestamp means the same thing on all three chains and is what the trusted-keys windows compare against.

**No sequence counter and no `prevRoot` hash chain.**

- Ordering already exists: block number plus log index.
- Contract storage is already an immutable ordered history.
- A hash chain does not detect the omission of a post inside a batch; receipts do (ADR-015).
- A hash chain creates head-of-line blocking between batches: batch k+1 cannot be built until batch k's root is final.
- Removing the counter saves one SSTORE per batch, about 5k gas (Estimate: 2,900 for a non-zero to non-zero write + 2,100 cold access).

**`verifyPost` receives the leaf as opaque bytes and double-hashes it**, so the immutable contract does not freeze the leaf format (ADR-014 can version it). Double hashing prevents second-preimage confusion between leaves and internal nodes (64-byte nodes): a 64-byte internal node can never be presented as a leaf, because a leaf is hashed twice.

**No proxy, no pause, not payable.** Nothing to upgrade, nobody to trust with an admin key. Same address on all chains via CREATE2: this needs the same deployer (factory) address on all three chains and byte-identical init code.

- Factory: the deterministic deployment proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C` that Foundry uses for `new X{salt: s}()`; its code is present and identical on the three testnets (Verified 2026-11-07: `cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url <rpc>` on the public RPCs listed in ADR-007).
- Compiler settings pinned in `contracts/foundry.toml`: solc 0.8.30, `evm_version = "cancun"` (Prague adds no opcode this contract needs), optimizer 200 runs, `bytecode_hash = "none"` and `cbor_metadata = false` so comment-only changes do not move the address.
- Address with salt `keccak256("onchain-posts/PostAnchor/v2")`: `0xD0fB2A7F1D12C5AF80E49B31Bcb1B4983AD7C5dB` on all three chains. Deployed on 2026-11-08 at that address on the three testnets; the runtime bytecode read from each chain has the same keccak as the local build (`0x6b515179b0a4266d92c42367a3ebae40c68171e6c09391d9fe7a96b5bf5ad6d5`, `cast code <address> --rpc-url <rpc> | cast keccak`), so the `cancun` bytecode runs unchanged on all three.

| Chain | Deployment transaction | Block | Gas used |
| ----- | ---------------------- | ----- | -------- |
| Ethereum Sepolia | [0x342de0c1...](https://sepolia.etherscan.io/tx/0x342de0c19f1987bd30c506f3b324a62e9df4d8dac80300f29ae8862d214f4801) | 12,093,208 | 1,899,086 |
| Base Sepolia | [0x26cdad46...](https://sepolia.basescan.org/tx/0x26cdad4683ecc4b2349ce051374a7b8d626e27e3c13ee37925beddaa4ce3ea9f) | 56,262,308 | 290,246 |
| Arbitrum Sepolia | [0xeb00ff21...](https://sepolia.arbiscan.io/tx/0xeb00ff21cdf67aa740cc07a7af198ee90d27ae74322c8390841aff2983922082) | 327,362,493 | 290,246 |

On Ethereum Sepolia the script runs with `--skip-simulation`: forge estimates gas with a local simulation under mainnet rules, which underestimates this deployment on Sepolia because Sepolia currently runs a different gas schedule (ADR-001); without the flag a first attempt reverted out of gas. With the flag, forge takes the node's estimate.

**Gas.** `anchor` costs 47,058 gas per batch regardless of N (measured with real transactions under mainnet rules, ADR-001; Estimate was about 47k).

### Invariants and tests

| ID | Invariant | Test type |
| -- | --------- | --------- |
| I1 | A (sender, root) can be anchored once only | Invariant test with handler |
| I2 | `anchoredAt` never changes once set | Invariant test with handler |
| I3 | `root == 0` always reverts, so `anchoredAt != 0` means anchored | Fuzz |
| I4 | Actions of one sender never alter another sender's records | Invariant test with handler |
| I5 | `verifyPost` returns true if and only if the leaf is in the tree of an anchored root | Fuzz |
| I6 | The contract cannot receive ETH through any call: no payable function, no `receive` or `fallback`, so every call with value reverts | Unit + fuzz |

Note on I6: ETH force-sent via `SELFDESTRUCT` (or as a block reward recipient) cannot be prevented by any contract. It is harmless here because no logic reads `address(this).balance` (`test_forcedEtherDoesNotChangeBehaviour`).

Status: all six are implemented and pass (`forge test`: 13 unit and fuzz tests with 1,000 fuzz runs each, 3 invariants with 256 runs x 128 calls). The invariant suite was checked against a mutant: with the `AlreadyAnchored` check removed, I1 and I4 fail (`anchored more than once: 2 > 1`), so they are not vacuous. Extra tests cover front-running by another sender, the single-leaf tree and second-preimage resistance (a 64-byte internal node submitted as a leaf returns false).

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| Immutable single relayer (address fixed at deploy) | Only the platform key can write | Rotation requires a redeploy and a new address (and a new EIP-712 domain, ADR-012) | Rotation is a normal operation |
| Owner-managed allowlist of relayers | On-chain list of trusted senders | Admin key = more attack surface and more trust; an owner can also be compromised | Off-chain trusted-keys file with per-sender records gives the same verification without an admin |
| Global `root => timestamp` mapping | Slightly simpler | Root squatting by front-running (see above); one sender's mistake affects all | Per-sender isolation |
| Store `manifestId` on-chain | Lookup from state | About +22k gas per batch (Estimate) | Event is enough for off-chain consumers |
| Event only (ours-lite) | About 22k less per batch (Estimate) | No on-chain idempotency, no contract-readable anchor | Measured in the benchmark; ADR-005 revisit criterion |
| Upgradeable proxy | Fixable | Admin key, storage-layout risk, more audit surface | Nothing in this contract justifies it |

## Consequences

Positive:

- A contract of two functions and one mapping, with no privileged role.
- Retries and duplicates are safe (I1); other writers cannot interfere (I4, front-running).

Negative:

- Trust in the platform keys lives off-chain, and so does revocation.
- A compromised relayer key's earlier anchors stay valid on-chain; only the revocation date in `config/trusted-keys.json` excludes later ones.

Follow-ups:

- Verify the source on the block explorers (needs explorer API keys).

## Evidence

- Gas: measured in ADR-001 (`packages/bench/results/2026-11-07-gas-local-prague.json`).
- Arbitrum `block.number` and `block.timestamp` semantics: Verified 2026-11-07 (link above).
- Real anchors (first post, 2026-11-08): 47,058 gas on Base Sepolia and Arbitrum Sepolia, identical to the local measurement, and 129,078 on Ethereum Sepolia (its different schedule). Arbitrum Sepolia charged no L1 component (`gasUsedForL1` 0) and Base Sepolia an L1 fee of 108 wei: testnet L1 fees are not representative, hence the mainnet snapshot for USD (ADR-001).
- To verify: timestamp bounds on Base.
