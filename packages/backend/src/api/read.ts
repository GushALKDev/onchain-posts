import { PROOF_SCHEMA, inclusionProof, treeFromManifest, type Manifest, type ProofBundle, type SignedReceipt } from '@onchain-posts/core';
import { bytesToHex, getAddress, hexToBytes, type Hex } from 'viem';
import type { Sql } from '../db.ts';
import { ApiError } from '../errors.ts';

type ChainRow = {
  chain_id: number;
  anchor_by: string;
  pc_state: string;
  batch_state: string | null;
  manifest: Manifest | null;
  manifest_arweave_id: string | null;
  sender: Buffer | null;
  tx_hash: Buffer | null;
  block_number: string | null;
  anchored_at: string | null;
};

type PostRow = { state: string; post_arweave_id: string | null; image_arweave_id: string | null; receipt: SignedReceipt; accepted_at: string };

async function load(sql: Sql, postHash: Hex): Promise<{ post: PostRow; chains: ChainRow[] }> {
  const key = Buffer.from(hexToBytes(postHash));
  const [post] = await sql<PostRow[]>`SELECT state, post_arweave_id, image_arweave_id, receipt, accepted_at FROM posts WHERE post_hash = ${key}`;
  if (!post) throw new ApiError(404, 'not-found', 'unknown postHash');
  const chains = await sql<ChainRow[]>`
    SELECT pc.chain_id, pc.anchor_by, pc.state AS pc_state, b.state AS batch_state, b.manifest, b.manifest_arweave_id, b.sender, b.tx_hash,
           b.block_number, b.anchored_at
    FROM post_chains pc LEFT JOIN batches b ON b.id = pc.batch_id
    WHERE pc.post_hash = ${key} ORDER BY pc.chain_id`;
  return { post, chains };
}

const isAnchored = (row: ChainRow) => row.batch_state === 'ANCHORED' || row.batch_state === 'SETTLED';

/**
 * GET /proof/:postHash: untrusted verification hints (ADR-014). Partial while chains are pending; never contains the
 * user's signature. Returns null while the post is not stored yet (no post Arweave ID to point to).
 */
export async function proofBundle(sql: Sql, postHash: Hex): Promise<ProofBundle | null> {
  const { post, chains } = await load(sql, postHash);
  if (!post.post_arweave_id) return null;
  const anchors: ProofBundle['anchors'] = [];
  const pending: ProofBundle['pending'] = [];
  for (const row of chains) {
    if (!isAnchored(row) || !row.manifest || !row.manifest_arweave_id || !row.sender || !row.tx_hash) {
      pending.push({ chainId: row.chain_id, anchorBy: Number(row.anchor_by) });
      continue;
    }
    const proof = inclusionProof(treeFromManifest(row.manifest), postHash);
    if (!proof) throw new Error(`post missing from its own batch manifest on chain ${row.chain_id}`);
    anchors.push({
      chainId: row.chain_id,
      sender: getAddress(bytesToHex(row.sender)),
      root: row.manifest.root,
      manifestId: row.manifest_arweave_id,
      txHash: bytesToHex(row.tx_hash),
      leafData: proof.leafData,
      proof: proof.proof,
    });
  }
  return { schema: PROOF_SCHEMA, postHash, postArweaveId: post.post_arweave_id, imageArweaveId: post.image_arweave_id, anchors, pending, receipt: post.receipt };
}

export type Stage = 'accepted' | 'published' | 'settled' | 'failed';

/** GET /status/:postHash: per-chain stage for the web app (Accepted / Published / Settled, ADR-017). */
export async function postStatus(sql: Sql, postHash: Hex) {
  const { post, chains } = await load(sql, postHash);
  return {
    postHash,
    state: post.state,
    acceptedAt: Number(post.accepted_at),
    postArweaveId: post.post_arweave_id,
    chains: chains.map((row) => {
      const state = row.batch_state ?? row.pc_state;
      const stage: Stage = state === 'SETTLED' ? 'settled' : state === 'ANCHORED' ? 'published' : state === 'FAILED' ? 'failed' : 'accepted';
      return {
        chainId: row.chain_id,
        stage,
        state,
        anchorBy: Number(row.anchor_by),
        txHash: row.tx_hash ? bytesToHex(row.tx_hash) : null,
        blockNumber: row.block_number === null ? null : Number(row.block_number),
        anchoredAt: row.anchored_at === null ? null : Number(row.anchored_at),
      };
    }),
  };
}
