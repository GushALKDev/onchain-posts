import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { arweaveIdToBytes32 } from './arweave.ts';
import { MANIFEST_SCHEMA } from './constants.ts';

/** phi.manifest/1 leaf: abi.encode(postHash, postArweaveId, sigCommit) (ADR-014). */
export const LEAF_ENCODING = ['bytes32', 'bytes32', 'bytes32'] as const;

export type LeafValue = [postHash: Hex, postArweaveId: Hex, sigCommit: Hex];
export type BatchEntry = { postHash: Hex; postArweaveId: string; sigCommit: Hex };
export type Manifest = { schema: typeof MANIFEST_SCHEMA; chainId: number; root: Hex; leafEncoding: string[]; leaves: LeafValue[] };
export type InclusionProof = { leafData: Hex; proof: Hex[] };

/** Opaque leaf bytes passed to PostAnchor.verifyPost. */
export function leafData(value: LeafValue): Hex {
  return encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], value);
}

/** Double-hashed leaf, as in StandardMerkleTree and PostAnchor.verifyPost. */
export function leafHash(value: LeafValue): Hex {
  return keccak256(keccak256(leafData(value)));
}

/** Builds the tree and manifest of one batch for one chain. The batch identity is (chainId, sender, root). */
export function buildBatch(chainId: number, entries: BatchEntry[]): { manifest: Manifest; tree: StandardMerkleTree<LeafValue> } {
  if (entries.length === 0) throw new Error('empty batch');
  const seen = new Set<string>();
  const values = entries.map((entry): LeafValue => {
    const key = entry.postHash.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate postHash in batch: ${entry.postHash}`);
    seen.add(key);
    return [entry.postHash, arweaveIdToBytes32(entry.postArweaveId), entry.sigCommit];
  });
  const tree = StandardMerkleTree.of(values, [...LEAF_ENCODING]);
  return { manifest: { schema: MANIFEST_SCHEMA, chainId, root: tree.root as Hex, leafEncoding: [...LEAF_ENCODING], leaves: values }, tree };
}

/** Rebuilds the tree from a manifest; leaf order does not matter because leaves are sorted by hash. */
export function treeFromManifest(manifest: Manifest): StandardMerkleTree<LeafValue> {
  return StandardMerkleTree.of(manifest.leaves, [...LEAF_ENCODING]);
}

export function manifestRootMatches(manifest: Manifest): boolean {
  return treeFromManifest(manifest).root.toLowerCase() === manifest.root.toLowerCase();
}

export function inclusionProof(tree: StandardMerkleTree<LeafValue>, postHash: Hex): InclusionProof | null {
  for (const [index, value] of tree.entries()) {
    if (value[0].toLowerCase() === postHash.toLowerCase()) return { leafData: leafData(value), proof: tree.getProof(index) as Hex[] };
  }
  return null;
}

export function verifyInclusion(root: Hex, value: LeafValue, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(root, [...LEAF_ENCODING], value, proof);
}
