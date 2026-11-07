// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title OursLite
 * @notice Benchmark variant ours-lite (ADR-001): same interface as PostAnchor.anchor, root in an event only, no
 *         storage slot. Measures the price of on-chain idempotency and contract readability. Never deployed as product.
 */
contract OursLite {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroRoot();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event BatchAnchored(address indexed sender, bytes32 indexed root, bytes32 manifestId, uint32 count);

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function anchor(bytes32 root, bytes32 manifestId, uint32 count) external {
        if (root == bytes32(0)) revert ZeroRoot();

        emit BatchAnchored(msg.sender, root, manifestId, count);
    }
}
