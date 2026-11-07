// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {PostAnchor} from "../../src/PostAnchor.sol";

/**
 * @title PostAnchorHandler
 * @notice Drives PostAnchor with a small set of senders and roots so that collisions (same sender and root,
 *         same root from different senders) happen often, and records ghost state for the invariants.
 */
contract PostAnchorHandler is CommonBase, StdUtils {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    PostAnchor public immutable postAnchor;

    address[] public senders;
    bytes32[] public roots;

    /**
     * @notice Timestamp recorded by the handler on the first successful anchor of (sender, root).
     */
    mapping(address sender => mapping(bytes32 root => uint256 timestamp)) public ghostAnchoredAt;

    /**
     * @notice Number of successful anchor calls per (sender, root).
     */
    mapping(address sender => mapping(bytes32 root => uint256 count)) public ghostSuccessCount;

    /**
     * @notice Set when the contract behaves differently from the model (unexpected success or revert).
     */
    bool public modelViolation;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(PostAnchor postAnchor_) {
        postAnchor = postAnchor_;
        for (uint256 i; i < 4; ++i) {
            senders.push(address(uint160(uint256(keccak256(abi.encode("sender", i))))));
        }
        for (uint256 i; i < 6; ++i) {
            roots.push(keccak256(abi.encode("root", i)));
        }
    }

    /*//////////////////////////////////////////////////////////////
                                ACTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Anchors a (sender, root) pair from the bounded domain after moving time forward.
     */
    function anchor(uint256 senderSeed, uint256 rootSeed, bytes32 manifestId, uint32 count, uint256 elapsed) external {
        address sender = senders[senderSeed % senders.length];
        bytes32 root = roots[rootSeed % roots.length];
        vm.warp(block.timestamp + bound(elapsed, 0, 1 days));

        bool alreadyAnchored = ghostAnchoredAt[sender][root] != 0;

        vm.prank(sender);
        try postAnchor.anchor(root, manifestId, count) {
            if (alreadyAnchored) modelViolation = true;
            ghostAnchoredAt[sender][root] = block.timestamp;
            ++ghostSuccessCount[sender][root];
        } catch (bytes memory reason) {
            if (!alreadyAnchored || keccak256(reason) != keccak256(abi.encodeWithSelector(PostAnchor.AlreadyAnchored.selector))) {
                modelViolation = true;
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                                GETTERS
    //////////////////////////////////////////////////////////////*/

    function senderCount() external view returns (uint256) {
        return senders.length;
    }

    function rootCount() external view returns (uint256) {
        return roots.length;
    }
}
