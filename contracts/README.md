# contracts

Foundry project for the on-chain part of the design: `PostAnchor` ([ADR-009](../docs/decisions/ADR-009-anchor-contract.md)) and the gas baselines of [ADR-001](../docs/decisions/ADR-001-efficiency-definition.md).

## Layout

| Path | Purpose |
| ---- | ------- |
| `src/PostAnchor.sol` | One transaction per batch and chain anchors a Merkle root with one storage slot; `verifyPost` checks a leaf against an anchored root. No owner, no proxy, not payable. |
| `test/PostAnchor.t.sol` | Unit and fuzz tests: I3, I5, I6, front-running by another sender, single-leaf tree, second-preimage resistance, `verifyPost` gas for a 500-leaf tree. |
| `test/invariant/` | Stateful invariants I1, I2, I4 with a handler over a bounded set of senders and roots, so duplicates and cross-sender collisions happen often. |
| `test/utils/MerkleTreeBuilder.sol` | Test-only tree builder with the same layout as OpenZeppelin `StandardMerkleTree` (sorted double-hashed leaves, sorted-pair nodes). |
| `bench/` | Baselines B0 (naive storage), B1 (one event per post), B2 (hash list per batch) and ours-lite (root in an event, no storage). Measured only, never deployed as product. |
| `script/DeployPostAnchor.s.sol` | CREATE2 deployment through the deterministic deployment proxy: same address on Ethereum Sepolia, Base Sepolia and Arbitrum Sepolia. |
| `snapshots/PostAnchor.json` | Gas recorded by the tests (`verifyPost` with a 9-hash proof). |

Compiler settings are pinned in `foundry.toml` (solc 0.8.30, `evm_version = "cancun"`, no metadata hash) because the CREATE2 address depends on byte-identical init code.

## Commands

```bash
git submodule update --init --recursive   # OpenZeppelin v5.7.0 and forge-std v1.17.0
forge test                                # 13 unit/fuzz tests (1,000 runs each) + 3 invariants (256 runs x 128 calls)
forge script script/DeployPostAnchor.s.sol --rpc-url <rpc>                                       # simulate, prints the address
forge script script/DeployPostAnchor.s.sol --rpc-url <rpc> --broadcast --private-key <key>      # deploy
```

The gas benchmark (all five variants, real receipts on a local node with mainnet rules) is run from the repository root with `node packages/bench/src/gas-bench.mjs`; see [docs/efficiency.md](../docs/efficiency.md).

## Invariants

| ID | Invariant | Test |
| -- | --------- | ---- |
| I1 | A (sender, root) can be anchored once only | `invariant_I1_anchorOncePerSenderAndRoot` |
| I2 | `anchoredAt` never changes once set | `invariant_I2_anchoredAtIsImmutable` |
| I3 | `root == 0` always reverts | `testFuzz_anchor_zeroRootReverts` |
| I4 | One sender's actions never alter another sender's records | `invariant_I4_senderIsolation`, `test_anchor_frontRunByOtherSenderDoesNotBlock` |
| I5 | `verifyPost` is true if and only if the leaf is in the tree of an anchored root | `testFuzz_verifyPost_memberLeafVerifies`, `testFuzz_verifyPost_nonMemberOrTamperedFails` |
| I6 | No call carrying ETH succeeds | `testFuzz_rejectsEther`, `test_forcedEtherDoesNotChangeBehaviour` |

The invariant suite was checked against a mutant with the `AlreadyAnchored` check removed: I1 and I4 fail, so they are not vacuous.

## Deployment status

Not broadcast yet: it needs a funded deployer key. Simulation against each testnet predicts `0x36b5D5F0D176b96013678FC69C34038897fAF382` on all three chains.
