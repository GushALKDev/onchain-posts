import { parseAbi } from 'viem';

/** ABI of contracts/src/PostAnchor.sol (ADR-009). */
export const postAnchorAbi = parseAbi([
  'error ZeroRoot()',
  'error AlreadyAnchored(bytes32 root, uint256 anchoredAt)',
  'event BatchAnchored(address indexed sender, bytes32 indexed root, bytes32 manifestId, uint32 count)',
  'function anchor(bytes32 root, bytes32 manifestId, uint32 count)',
  'function anchoredAt(address sender, bytes32 root) view returns (uint256)',
  'function verifyPost(address sender, bytes32 root, bytes leafData, bytes32[] proof) view returns (bool)',
]);
