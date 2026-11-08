// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title PostAnchor
 * @notice Anchors one Merkle root per batch of posts. Permissionless: records are keyed by the sender, so every
 *         verification must check the sender against the trusted relayer list (config/trusted-keys.json).
 * @dev No owner, no proxy, no pause, not payable. Design and invariants: docs/decisions/ADR-009-anchor-contract.md.
 */
contract PostAnchor {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice The zero root is reserved: anchoredAt == 0 means "not anchored".
     */
    error ZeroRoot();

    /**
     * @notice The sender already anchored this root.
     */
    error AlreadyAnchored();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Emitted once per anchored batch.
     * @param sender Address that anchored the batch.
     * @param root Merkle root of the batch.
     * @param manifestId Arweave ID of the batch manifest, decoded to 32 bytes.
     * @param count Number of posts in the batch.
     */
    event BatchAnchored(address indexed sender, bytes32 indexed root, bytes32 manifestId, uint32 count);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Anchoring timestamp per sender and root; 0 means not anchored.
     */
    mapping(address sender => mapping(bytes32 root => uint256 timestamp)) public anchoredAt;

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Anchors a batch root under msg.sender.
     * @dev block.timestamp is never 0 on a live chain, so a stored 0 unambiguously means "not anchored".
     * @param root Merkle root of the batch.
     * @param manifestId Arweave ID of the batch manifest, decoded to 32 bytes (event only).
     * @param count Number of posts in the batch (event only).
     */
    function anchor(bytes32 root, bytes32 manifestId, uint32 count) external {
        if (root == bytes32(0)) revert ZeroRoot();
        if (anchoredAt[msg.sender][root] != 0) revert AlreadyAnchored();

        anchoredAt[msg.sender][root] = block.timestamp;

        emit BatchAnchored(msg.sender, root, manifestId, count);
    }

    /**
     * @notice Checks that a post leaf belongs to a root anchored by `sender`.
     * @dev The leaf is opaque bytes and double-hashed (OpenZeppelin StandardMerkleTree convention), so the leaf
     *      format can evolve without redeploying and a 64-byte internal node can never pass as a leaf.
     * @param sender Address that anchored the root; callers must check it is a trusted relayer.
     * @param root Anchored Merkle root.
     * @param leafData abi.encode(postHash, postArweaveId, sigCommit) for onchain-posts.manifest/1 (ADR-014).
     * @param proof Sibling hashes from the leaf to the root.
     * @return True if the root is anchored by `sender` and the leaf is in its tree.
     */
    function verifyPost(address sender, bytes32 root, bytes calldata leafData, bytes32[] calldata proof) external view returns (bool) {
        if (anchoredAt[sender][root] == 0) return false;

        bytes32 leaf = keccak256(bytes.concat(keccak256(leafData)));
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }
}
