// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title B2HashList
 * @notice Benchmark baseline B2 (ADR-001): one transaction per batch per chain that emits the N postHashes
 *         (hash list, no tree). The non-Merkle rival with the same batching. Measured only, never deployed as product.
 */
contract B2HashList {
    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event BatchPublished(address indexed sender, bytes32[] postHashes);

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function publishBatch(bytes32[] calldata postHashes) external {
        emit BatchPublished(msg.sender, postHashes);
    }
}
