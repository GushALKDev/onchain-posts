// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PostAnchor} from "../src/PostAnchor.sol";
import {MerkleTreeBuilder} from "./utils/MerkleTreeBuilder.sol";

/**
 * @title CoreFixtureTest
 * @notice Cross-implementation check: the tree, leaves and proofs produced by packages/core (@openzeppelin/merkle-tree)
 *         must match the Solidity builder and verify in PostAnchor. Regenerate the fixture with `pnpm fixtures` in
 *         packages/core.
 */
contract CoreFixtureTest is Test {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    string internal constant FIXTURE = "../packages/core/test/fixtures/merkle-fixture.json";

    PostAnchor internal postAnchor;
    address internal relayer = makeAddr("relayer");

    /*//////////////////////////////////////////////////////////////
                                 SETUP
    //////////////////////////////////////////////////////////////*/

    function setUp() public {
        postAnchor = new PostAnchor();
        vm.warp(1_762_480_000);
    }

    /*//////////////////////////////////////////////////////////////
                                 TESTS
    //////////////////////////////////////////////////////////////*/

    function test_coreFixture_rootLeavesAndProofsMatchContract() public {
        string memory json = vm.readFile(FIXTURE);
        bytes32 root = vm.parseJsonBytes32(json, ".root");
        uint256 count = vm.parseJsonUint(json, ".count");

        bytes[] memory leafData = new bytes[](count);
        bytes32[] memory leafHashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            string memory leaf = string.concat(".leaves[", vm.toString(i), "]");
            leafData[i] = vm.parseJsonBytes(json, string.concat(leaf, ".leafData"));
            leafHashes[i] = MerkleTreeBuilder.leafHash(leafData[i]);

            (bytes32 postHash,, bytes32 sigCommit) = abi.decode(leafData[i], (bytes32, bytes32, bytes32));
            assertEq(postHash, vm.parseJsonBytes32(json, string.concat(leaf, ".postHash")), "leafData does not encode postHash first");
            assertEq(sigCommit, vm.parseJsonBytes32(json, string.concat(leaf, ".sigCommit")), "leafData does not encode sigCommit last");
        }

        assertEq(MerkleTreeBuilder.build(leafHashes)[0], root, "Solidity builder and @openzeppelin/merkle-tree disagree on the root");

        vm.prank(relayer);
        postAnchor.anchor(root, keccak256("manifest"), uint32(count));

        for (uint256 i; i < count; ++i) {
            bytes32[] memory proof = vm.parseJsonBytes32Array(json, string.concat(".leaves[", vm.toString(i), "].proof"));
            assertTrue(postAnchor.verifyPost(relayer, root, leafData[i], proof), "proof from packages/core rejected by PostAnchor");
        }
    }
}
