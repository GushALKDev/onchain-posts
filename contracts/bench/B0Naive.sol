// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title B0Naive
 * @notice Benchmark baseline B0 (ADR-001): stores username, caption and imageHash in contract storage, one
 *         transaction per post per chain. Measured only, never deployed as product.
 */
contract B0Naive {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    struct Post {
        bytes32 imageHash; // 32 bytes -── Slot 0 (full)
        string username; //   32 bytes -── Slot 1 (pointer)
        string caption; //    32 bytes -── Slot 2 (pointer)
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    mapping(bytes32 postHash => Post post) public posts;

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function publish(bytes32 postHash, string calldata username, string calldata caption, bytes32 imageHash) external {
        posts[postHash] = Post({imageHash: imageHash, username: username, caption: caption});
    }
}
