// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/**
 * @title MerkleTreeBuilder
 * @notice Test-only Merkle tree builder that mirrors the OpenZeppelin StandardMerkleTree layout:
 *         double-hashed leaves sorted ascending, complete binary tree stored as an array, sorted-pair node hashing.
 * @dev Mirroring the layout (not only the hashing) keeps roots identical to @openzeppelin/merkle-tree, so the same
 *      fixtures can later be cross-checked from packages/core.
 */
library MerkleTreeBuilder {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice A tree needs at least one leaf.
     */
    error EmptyTree();

    /**
     * @notice The leaf hash is not in the tree.
     */
    error LeafNotFound(bytes32 leaf);

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Leaf hash used by PostAnchor.verifyPost and StandardMerkleTree.
     */
    function leafHash(bytes memory leafData) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(leafData)));
    }

    /**
     * @notice Builds the tree array from leaf hashes; tree[0] is the root.
     */
    function build(bytes32[] memory leafHashes) internal pure returns (bytes32[] memory tree) {
        uint256 n = leafHashes.length;
        if (n == 0) revert EmptyTree();

        bytes32[] memory sorted = _sortedCopy(leafHashes);
        tree = new bytes32[](2 * n - 1);
        for (uint256 j; j < n; ++j) {
            tree[tree.length - 1 - j] = sorted[j];
        }
        // Internal nodes occupy indices [0, n - 1); children of i are 2i + 1 and 2i + 2.
        for (uint256 k = n - 1; k > 0; --k) {
            uint256 i = k - 1;
            tree[i] = Hashes.commutativeKeccak256(tree[2 * i + 1], tree[2 * i + 2]);
        }
    }

    /**
     * @notice Proof for a leaf hash, in the order MerkleProof.verify expects (leaf to root).
     */
    function getProof(bytes32[] memory tree, bytes32 leaf) internal pure returns (bytes32[] memory proof) {
        uint256 index = _leafIndex(tree, leaf);

        uint256 depth;
        for (uint256 i = index; i > 0; i = (i - 1) / 2) {
            ++depth;
        }

        proof = new bytes32[](depth);
        uint256 cursor = index;
        for (uint256 d; d < depth; ++d) {
            uint256 sibling = cursor % 2 == 1 ? cursor + 1 : cursor - 1;
            proof[d] = tree[sibling];
            cursor = (cursor - 1) / 2;
        }
    }

    /*//////////////////////////////////////////////////////////////
                           PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _leafIndex(bytes32[] memory tree, bytes32 leaf) private pure returns (uint256) {
        uint256 n = (tree.length + 1) / 2;
        for (uint256 i = tree.length - n; i < tree.length; ++i) {
            if (tree[i] == leaf) return i;
        }
        revert LeafNotFound(leaf);
    }

    function _sortedCopy(bytes32[] memory values) private pure returns (bytes32[] memory sorted) {
        sorted = new bytes32[](values.length);
        for (uint256 i; i < values.length; ++i) {
            bytes32 value = values[i];
            uint256 j = i;
            while (j > 0 && uint256(sorted[j - 1]) > uint256(value)) {
                sorted[j] = sorted[j - 1];
                --j;
            }
            sorted[j] = value;
        }
    }
}
