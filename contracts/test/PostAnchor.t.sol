// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import {PostAnchor} from "../src/PostAnchor.sol";
import {MerkleTreeBuilder} from "./utils/MerkleTreeBuilder.sol";

/**
 * @title PostAnchorTest
 * @notice Unit and fuzz tests for PostAnchor. Invariant IDs refer to ADR-009 (I3, I5, I6 here; I1, I2, I4 in the
 *         invariant suite).
 */
contract PostAnchorTest is Test {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    PostAnchor internal postAnchor;

    address internal relayer = makeAddr("relayer");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant ROOT = keccak256("root");
    bytes32 internal constant MANIFEST_ID = keccak256("manifest");

    event BatchAnchored(address indexed sender, bytes32 indexed root, bytes32 manifestId, uint32 count);

    /*//////////////////////////////////////////////////////////////
                                 SETUP
    //////////////////////////////////////////////////////////////*/

    function setUp() public {
        postAnchor = new PostAnchor();
        vm.warp(1_762_480_000);
    }

    /*//////////////////////////////////////////////////////////////
                                 ANCHOR
    //////////////////////////////////////////////////////////////*/

    function test_anchor_storesTimestampAndEmits() public {
        vm.expectEmit(address(postAnchor));
        emit BatchAnchored(relayer, ROOT, MANIFEST_ID, 3);

        vm.prank(relayer);
        postAnchor.anchor(ROOT, MANIFEST_ID, 3);

        assertEq(postAnchor.anchoredAt(relayer, ROOT), block.timestamp);
    }

    function test_anchor_revertsOnDuplicate() public {
        vm.startPrank(relayer);
        postAnchor.anchor(ROOT, MANIFEST_ID, 3);

        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(PostAnchor.AlreadyAnchored.selector);
        postAnchor.anchor(ROOT, MANIFEST_ID, 3);
        vm.stopPrank();
    }

    /**
     * @notice I4 / front-running: a root copied from the mempool and anchored first by another sender does not
     *         block the relayer, and each sender keeps its own timestamp.
     */
    function test_anchor_frontRunByOtherSenderDoesNotBlock() public {
        vm.prank(attacker);
        postAnchor.anchor(ROOT, MANIFEST_ID, 3);

        vm.warp(block.timestamp + 12);
        vm.prank(relayer);
        postAnchor.anchor(ROOT, MANIFEST_ID, 3);

        assertEq(postAnchor.anchoredAt(attacker, ROOT), block.timestamp - 12);
        assertEq(postAnchor.anchoredAt(relayer, ROOT), block.timestamp);
    }

    /**
     * @notice I3: the zero root always reverts, whoever sends it.
     */
    function testFuzz_anchor_zeroRootReverts(address sender, bytes32 manifestId, uint32 count) public {
        vm.prank(sender);
        vm.expectRevert(PostAnchor.ZeroRoot.selector);
        postAnchor.anchor(bytes32(0), manifestId, count);

        assertEq(postAnchor.anchoredAt(sender, bytes32(0)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                              VERIFY POST
    //////////////////////////////////////////////////////////////*/

    function test_verifyPost_singleLeafTree() public {
        bytes memory leafData = _leafData(1);
        bytes32 root = MerkleTreeBuilder.leafHash(leafData);
        _anchorAs(relayer, root);

        assertTrue(postAnchor.verifyPost(relayer, root, leafData, new bytes32[](0)));
    }

    function test_verifyPost_unanchoredRootReturnsFalse() public view {
        bytes memory leafData = _leafData(1);
        bytes32 root = MerkleTreeBuilder.leafHash(leafData);

        assertFalse(postAnchor.verifyPost(relayer, root, leafData, new bytes32[](0)));
    }

    function test_verifyPost_otherSenderReturnsFalse() public {
        bytes memory leafData = _leafData(1);
        bytes32 root = MerkleTreeBuilder.leafHash(leafData);
        _anchorAs(attacker, root);

        assertFalse(postAnchor.verifyPost(relayer, root, leafData, new bytes32[](0)));
    }

    /**
     * @notice Second-preimage resistance: the 64-byte preimage of an internal node cannot pass as a leaf,
     *         because leaves are hashed twice.
     */
    function test_verifyPost_internalNodePreimageIsNotALeaf() public {
        bytes32 left = MerkleTreeBuilder.leafHash(_leafData(1));
        bytes32 right = MerkleTreeBuilder.leafHash(_leafData(2));
        bytes32 root = Hashes.commutativeKeccak256(left, right);
        _anchorAs(relayer, root);

        (bytes32 a, bytes32 b) = left < right ? (left, right) : (right, left);
        assertFalse(postAnchor.verifyPost(relayer, root, abi.encodePacked(a, b), new bytes32[](0)));
    }

    /**
     * @notice I5 (completeness): every leaf of an anchored tree verifies, for trees of 1 to 64 leaves.
     */
    function testFuzz_verifyPost_memberLeafVerifies(uint256 seed, uint8 rawCount, uint256 rawIndex) public {
        uint256 count = bound(rawCount, 1, 64);
        uint256 index = bound(rawIndex, 0, count - 1);
        (bytes[] memory leafData, bytes32[] memory tree) = _tree(seed, count);
        _anchorAs(relayer, tree[0]);

        bytes32[] memory proof = MerkleTreeBuilder.getProof(tree, MerkleTreeBuilder.leafHash(leafData[index]));
        assertTrue(postAnchor.verifyPost(relayer, tree[0], leafData[index], proof));
    }

    /**
     * @notice I5 (soundness): a leaf outside the tree, or a member leaf with a tampered proof, does not verify.
     */
    function testFuzz_verifyPost_nonMemberOrTamperedFails(uint256 seed, uint8 rawCount, uint256 rawIndex, bytes32 noise) public {
        uint256 count = bound(rawCount, 2, 64);
        uint256 index = bound(rawIndex, 0, count - 1);
        vm.assume(noise != bytes32(0));
        (bytes[] memory leafData, bytes32[] memory tree) = _tree(seed, count);
        _anchorAs(relayer, tree[0]);

        bytes32[] memory proof = MerkleTreeBuilder.getProof(tree, MerkleTreeBuilder.leafHash(leafData[index]));

        bytes memory outsider = abi.encode(keccak256(abi.encode(seed, "outsider")), bytes32(0), bytes32(0));
        assertFalse(postAnchor.verifyPost(relayer, tree[0], outsider, proof));

        proof[0] ^= noise;
        assertFalse(postAnchor.verifyPost(relayer, tree[0], leafData[index], proof));
    }

    /*//////////////////////////////////////////////////////////////
                                 ETHER
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice I6: any call carrying ETH reverts (no payable function, no receive, no fallback).
     */
    function testFuzz_rejectsEther(uint256 rawValue, uint8 selectorChoice, bytes calldata arbitrary) public {
        uint256 value = bound(rawValue, 1, 1_000 ether);
        vm.deal(relayer, value);

        bytes memory data;
        if (selectorChoice % 4 == 0) data = abi.encodeCall(PostAnchor.anchor, (ROOT, MANIFEST_ID, 1));
        else if (selectorChoice % 4 == 1) data = abi.encodeCall(PostAnchor.verifyPost, (relayer, ROOT, "", new bytes32[](0)));
        else if (selectorChoice % 4 == 2) data = "";
        else data = arbitrary;

        vm.prank(relayer);
        (bool success,) = address(postAnchor).call{value: value}(data);

        assertFalse(success);
        assertEq(address(postAnchor).balance, 0);
    }

    /**
     * @notice ETH force-sent (SELFDESTRUCT, block reward) cannot be refused but changes nothing: no logic reads
     *         the balance.
     */
    function test_forcedEtherDoesNotChangeBehaviour() public {
        vm.deal(address(postAnchor), 1 ether);

        _anchorAs(relayer, ROOT);

        assertEq(postAnchor.anchoredAt(relayer, ROOT), block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                                  GAS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Execution gas of verifyPost for a 500-leaf tree (proof of 9 hashes), recorded in snapshots/.
     */
    function test_gas_verifyPost_500Leaves() public {
        (bytes[] memory leafData, bytes32[] memory tree) = _tree(42, 500);
        _anchorAs(relayer, tree[0]);
        bytes32[] memory proof = MerkleTreeBuilder.getProof(tree, MerkleTreeBuilder.leafHash(leafData[0]));
        assertEq(proof.length, 9);

        postAnchor.verifyPost(relayer, tree[0], leafData[0], proof);
        vm.snapshotGasLastCall("PostAnchor", "verifyPost_500_leaves_proof_9");
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _anchorAs(address sender, bytes32 root) internal {
        vm.prank(sender);
        postAnchor.anchor(root, MANIFEST_ID, 1);
    }

    /**
     * @dev onchain-posts.manifest/1 leaf: abi.encode(postHash, postArweaveId, sigCommit).
     */
    function _leafData(uint256 i) internal pure returns (bytes memory) {
        return abi.encode(keccak256(abi.encode("postHash", i)), keccak256(abi.encode("arweaveId", i)), keccak256(abi.encode("sig", i)));
    }

    function _tree(uint256 seed, uint256 count) internal pure returns (bytes[] memory leafData, bytes32[] memory tree) {
        leafData = new bytes[](count);
        bytes32[] memory hashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            leafData[i] = _leafData(uint256(keccak256(abi.encode(seed, i))));
            hashes[i] = MerkleTreeBuilder.leafHash(leafData[i]);
        }
        tree = MerkleTreeBuilder.build(hashes);
    }
}
