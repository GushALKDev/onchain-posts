# ADR-005: Commitment structure: binary Merkle tree

Status: Accepted
Confidence: Medium (depends on the benchmark crossover, see Revisit criterion)
Reversibility: One-way door (anchored roots are permanent and `verifyPost` checks Merkle proofs; a different structure needs a new contract)
Date: 2026-11-07
Updated: 2026-11-09

## Context

ADR-004 puts one 32-byte commitment per batch on-chain. The brief says Merkle trees are not required, so the choice has to be argued, not assumed. Requirement for the commitment: **constant on-chain size per batch at any N, and inclusion of a single post provable off-chain and by a contract, with standard tooling.**

## Decision

A **binary Merkle tree** over the batch leaves (leaf format in ADR-014), built with OpenZeppelin `StandardMerkleTree` (sorted leaves, double-hashed leaves, sorted-pair internal nodes), matching `MerkleProof.verifyCalldata` in the contract (ADR-009).

- Proof size: ceil(log2(N)) hashes. N = 500: 9 x 32 bytes (Estimate: log2(500) = 8.97).
- Contract verification: 3,637 gas of execution for a 500-leaf tree with a 9-hash proof (measured: `forge test --match-test test_gas_verifyPost_500Leaves`, recorded in `contracts/snapshots/PostAnchor.json`; calldata for the call comes on top).
- Building the tree: 0 gas, done by the backend.

Worked example (Illustrative): 4 posts with leaves L1..L4. root = H(H(L1, L2), H(L3, L4)); the proof for L1 is [L2, H(L3, L4)]. With OpenZeppelin, H sorts the pair before hashing, so the verifier does not need left/right flags.

**Why Merkle when the brief says it is not required:** chosen for constant on-chain size and contract-level composability (any contract can check that a post was published, without trusting the platform), not by reflex, and benchmarked against the non-Merkle alternative (B2 and ours-lite in ADR-001).

**Revisit criterion.** If typical batch sizes stay below the crossover (N = 20 vs B2 on L1, measured, ADR-001; it was estimated at 34 before the EIP-7623 calldata floor showed up in the measurement) and contract-level inclusion proofs are not needed, then ours-lite or B2 is the better choice. Choosing Merkle anyway would then be a deliberate trade for composability, and must be described as such in this ADR.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
| ------ | ---- | ---- | -------------- |
| **Runner-up 1: hash list in the event (B2)** | Same batching; leaves available on-chain; cheaper on gas for small N on L1 (ADR-001 crossover) | Calldata grows linearly with N; a contract-level inclusion check needs the whole list | Measured, not argued: kept as baseline B2 |
| **Runner-up 2: flat hash of the manifest** | Simplest; equally good if contract-level verification were not needed | Inclusion requires the whole manifest: 500 x 96 B = 48 KB, about 770k gas of calldata alone (Estimate: 48,000 x 16) | Not usable by contracts |
| Per-post anchoring | Direct lookup | N x SSTORE | Linear cost |
| Merkle Mountain Range | Append-only global accumulator | Global accumulator not needed; proofs must be maintained as it grows | Complexity without a need |
| Sparse Merkle Tree | Non-membership proofs | Non-membership is not needed (omission is handled by receipts, ADR-015) | Not needed |
| KZG / Verkle | Constant-size proofs | Trusted setup; complex tooling; proof size is irrelevant here | Complexity without benefit |
| RSA accumulator | Constant-size membership | Setup and cost | Not justified |
| Bloom filter | Compact | False positives; not a proof | Not a proof |

**Variant considered: emitting all leaf hashes in the event.** It makes the leaf hashes available on-chain, so proofs could be built without Arweave, at about 770 extra gas per post (Estimate: 32 B calldata x 16 + 32 B log data x 8 = 768, plus the L1 data fee on L2s). Rejected for cost. Consequence, documented as a **trust assumption**: generating proofs depends on the manifest being available on Arweave.

## Consequences

Positive:

- Constant on-chain footprint per batch at any N.
- Inclusion proofs of 9 hashes at Nmax = 500, verifiable off-chain and in any contract.
- Standard tooling in TypeScript and Solidity.

Negative:

- More expensive than B2 below N = 20 on L1 and than B1 below N = 3 (measured, ADR-001).
- Proof generation depends on the manifest on Arweave.
- Other implementations must reproduce the OpenZeppelin conventions (sorted leaves, sorted pairs, double-hashed leaves) to get the same root.

Follow-ups:

- **Future work: a ZK validity proof per batch**, proving that every leaf carries a valid signature of a registered user without revealing who. It removes the need to trust the relayer for "posts come from real users" and is the only mechanism considered in this design that would close the fabrication gap described in ADR-015. Verification cost is paid once per batch, on the order of 200k to 300k gas (To verify by proof system), amortised over N.
- Apply the revisit criterion once typical batch sizes are known: the benchmark gives the crossovers, real traffic gives N.

## Evidence

- Crossovers: measured in ADR-001 (`packages/bench/results/2026-11-07-gas-local-prague.json`).
- OpenZeppelin `StandardMerkleTree` sorts leaves by default, double-hashes them and hashes internal nodes as sorted pairs (Verified 2026-11-07: https://github.com/OpenZeppelin/merkle-tree, README; re-check against the pinned library versions when implementing).
- `verifyPost` gas for N = 500: 3,637 (measured, see Decision).
- To verify: ZK verification cost by proof system.
