// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PostAnchor} from "../../src/PostAnchor.sol";
import {PostAnchorHandler} from "./PostAnchorHandler.sol";

/**
 * @title PostAnchorInvariantTest
 * @notice Stateful invariants I1, I2 and I4 from ADR-009.
 */
contract PostAnchorInvariantTest is Test {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    PostAnchor internal postAnchor;
    PostAnchorHandler internal handler;

    /*//////////////////////////////////////////////////////////////
                                 SETUP
    //////////////////////////////////////////////////////////////*/

    function setUp() public {
        vm.warp(1_762_480_000);
        postAnchor = new PostAnchor();
        handler = new PostAnchorHandler(postAnchor);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = PostAnchorHandler.anchor.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /*//////////////////////////////////////////////////////////////
                               INVARIANTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice I1: a (sender, root) is anchored at most once; duplicates revert with AlreadyAnchored.
     */
    function invariant_I1_anchorOncePerSenderAndRoot() public view {
        _forEachPair(_assertAtMostOnce);
        assertFalse(handler.modelViolation(), "contract diverged from the model");
    }

    /**
     * @notice I2: anchoredAt never changes once set, whatever happens afterwards.
     */
    function invariant_I2_anchoredAtIsImmutable() public view {
        _forEachPair(_assertMatchesGhost);
    }

    /**
     * @notice I4: a sender's record is set only by that sender's own successful call; no other sender's action
     *         creates, changes or blocks it.
     */
    function invariant_I4_senderIsolation() public view {
        _forEachPair(_assertSetOnlyByOwnCall);
        assertFalse(handler.modelViolation(), "a sender was blocked or affected by another sender");
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _forEachPair(function(address, bytes32) internal view check) internal view {
        uint256 senderCount = handler.senderCount();
        uint256 rootCount = handler.rootCount();
        for (uint256 s; s < senderCount; ++s) {
            for (uint256 r; r < rootCount; ++r) {
                check(handler.senders(s), handler.roots(r));
            }
        }
    }

    function _assertAtMostOnce(address sender, bytes32 root) internal view {
        assertLe(handler.ghostSuccessCount(sender, root), 1, "anchored more than once");
    }

    function _assertMatchesGhost(address sender, bytes32 root) internal view {
        assertEq(postAnchor.anchoredAt(sender, root), handler.ghostAnchoredAt(sender, root), "anchoredAt changed or diverged");
    }

    function _assertSetOnlyByOwnCall(address sender, bytes32 root) internal view {
        bool isSet = postAnchor.anchoredAt(sender, root) != 0;
        assertEq(isSet, handler.ghostSuccessCount(sender, root) == 1, "record not owned by its sender");
    }
}
