import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { keccak256, toBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { LEAF_ENCODING, buildBatch, inclusionProof, leafData, leafHash, manifestRootMatches, treeFromManifest, verifyInclusion, type BatchEntry, type LeafValue } from '../src/index.ts';
import { sampleArweaveId } from './helpers.ts';

const entry = (i: number): BatchEntry => ({
  postHash: keccak256(toBytes(`post ${i}`)),
  postArweaveId: sampleArweaveId(`arweave ${i}`),
  sigCommit: keccak256(toBytes(`sig ${i}`)),
});

describe('Merkle batch', () => {
  it('leafHash equals the StandardMerkleTree leaf hash (same double hashing as PostAnchor.verifyPost)', () => {
    const { tree } = buildBatch(84532, [entry(1), entry(2)]);
    for (const [, value] of tree.entries()) expect(leafHash(value)).toBe(tree.leafHash(value));
  });

  it('leafData is the 96-byte abi.encode of the three values', () => {
    const value: LeafValue = [keccak256(toBytes('a')), keccak256(toBytes('b')), keccak256(toBytes('c'))];
    expect(leafData(value)).toBe(`0x${value.map((v) => v.slice(2)).join('')}`);
  });

  it('every entry has a proof that verifies against the root', () => {
    const entries = Array.from({ length: 13 }, (_, i) => entry(i));
    const { manifest, tree } = buildBatch(84532, entries);
    for (const e of entries) {
      const proof = inclusionProof(tree, e.postHash)!;
      const value = manifest.leaves.find((v) => v[0] === e.postHash)!;
      expect(verifyInclusion(manifest.root, value, proof.proof)).toBe(true);
    }
  });

  it('a tampered leaf or proof does not verify', () => {
    const { manifest, tree } = buildBatch(84532, [entry(1), entry(2), entry(3)]);
    const proof = inclusionProof(tree, entry(1).postHash)!.proof;
    const value = manifest.leaves.find((v) => v[0] === entry(1).postHash)!;
    expect(verifyInclusion(manifest.root, [value[0], value[1], keccak256(toBytes('forged'))], proof)).toBe(false);
    expect(verifyInclusion(manifest.root, value, [keccak256(toBytes('x')), ...proof.slice(1)])).toBe(false);
  });

  it('a single-post batch has the leaf hash as root and an empty proof', () => {
    const { manifest, tree } = buildBatch(84532, [entry(7)]);
    expect(manifest.root).toBe(leafHash(manifest.leaves[0]!));
    expect(inclusionProof(tree, entry(7).postHash)!.proof).toEqual([]);
  });

  it('the root does not depend on the order of the entries', () => {
    const entries = [entry(1), entry(2), entry(3), entry(4)];
    expect(buildBatch(1, entries).manifest.root).toBe(buildBatch(1, [...entries].reverse()).manifest.root);
  });

  it('the manifest rebuilds to its root, and a tampered manifest does not', () => {
    const { manifest } = buildBatch(84532, [entry(1), entry(2), entry(3)]);
    expect(manifestRootMatches(manifest)).toBe(true);
    expect(treeFromManifest(manifest).root).toBe(StandardMerkleTree.of(manifest.leaves, [...LEAF_ENCODING]).root);
    const tampered = { ...manifest, leaves: manifest.leaves.slice(1) };
    expect(manifestRootMatches(tampered)).toBe(false);
  });

  it('rejects duplicate post hashes and empty batches', () => {
    expect(() => buildBatch(1, [entry(1), entry(1)])).toThrow(/duplicate postHash/);
    expect(() => buildBatch(1, [])).toThrow(/empty batch/);
  });

  it('returns null for a post that is not in the batch', () => {
    const { tree } = buildBatch(1, [entry(1)]);
    expect(inclusionProof(tree, entry(2).postHash)).toBeNull();
  });
});
