// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title B1EventPerPost
 * @notice Benchmark baseline B1 (ADR-001): one transaction per post per chain that only emits the postHash.
 *         Measured only, never deployed as product.
 */
contract B1EventPerPost {
    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Indexed so a post can be looked up by hash, which is the point of per-post anchoring.
     */
    event PostPublished(bytes32 indexed postHash);

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function publish(bytes32 postHash) external {
        emit PostPublished(postHash);
    }
}
