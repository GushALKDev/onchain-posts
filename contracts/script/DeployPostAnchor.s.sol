// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PostAnchor} from "../src/PostAnchor.sol";

/**
 * @title DeployPostAnchor
 * @notice Deploys PostAnchor through the deterministic CREATE2 deployer, so the address is identical on Ethereum
 *         Sepolia, Base Sepolia and Arbitrum Sepolia as long as the compiler settings in foundry.toml do not change.
 * @dev forge script script/DeployPostAnchor.s.sol --rpc-url <rpc> --broadcast --private-key <key>
 */
contract DeployPostAnchor is Script {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice The CREATE2 deployment landed at an address other than the predicted one.
     */
    error UnexpectedAddress(address expected, address deployed);

    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    bytes32 internal constant SALT = keccak256("phi-onchain-posts/PostAnchor/v1");

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function run() external returns (PostAnchor postAnchor) {
        address expected = vm.computeCreate2Address(SALT, keccak256(type(PostAnchor).creationCode));
        console.log("Predicted PostAnchor address:", expected);

        // Idempotent: re-running on a chain where it already exists is a no-op.
        if (expected.code.length != 0) {
            console.log("Already deployed on chain", block.chainid);
            return PostAnchor(expected);
        }

        vm.startBroadcast();
        postAnchor = new PostAnchor{salt: SALT}();
        vm.stopBroadcast();

        if (address(postAnchor) != expected) revert UnexpectedAddress(expected, address(postAnchor));
        console.log("Deployed on chain", block.chainid);
    }
}
