import { inclusionProof, treeFromManifest, type Manifest, type SignedReceipt } from '@phi/core';
import { bytesToHex, getAddress, hexToBytes, type Hex } from 'viem';
import type { Sql } from '../db.ts';
import { ApiError } from '../errors.ts';
import type { Stage } from './read.ts';

type PostRow = {
  post_hash: Buffer;
  username: string;
  caption: string;
  created_at: string;
  accepted_at: string;
  stored_at: string | null;
  state: string;
  post_arweave_id: string | null;
  image_arweave_id: string | null;
  image_hash: Buffer;
  image_meta: { bytes: number; width: number; height: number } | null;
  sig_commit: Buffer;
  receipt: SignedReceipt;
};

type ChainRow = {
  post_hash: Buffer;
  chain_id: number;
  anchor_by: string;
  pc_state: string;
  batch_id: string | null;
  batch_state: string | null;
  root: Buffer | null;
  manifest: Manifest | null;
  manifest_arweave_id: string | null;
  post_count: number | null;
  sender: Buffer | null;
  nonce: string | null;
  tx_hash: Buffer | null;
  tx_history: Hex[] | null;
  batched_at: string | null;
  submitted_at: string | null;
  block_number: string | null;
  anchored_at: string | null;
  settled_at: string | null;
};

const num = (v: string | null) => (v === null ? null : Number(v));

function stageOf(row: ChainRow): Stage {
  const state = row.batch_state ?? row.pc_state;
  return state === 'SETTLED' ? 'settled' : state === 'ANCHORED' ? 'published' : state === 'FAILED' ? 'failed' : 'accepted';
}

async function chainsFor(sql: Sql, keys: Buffer[]): Promise<ChainRow[]> {
  if (keys.length === 0) return [];
  return sql<ChainRow[]>`
    SELECT pc.post_hash, pc.chain_id, pc.anchor_by, pc.state AS pc_state, b.id AS batch_id, b.state AS batch_state, b.root, b.manifest,
           b.manifest_arweave_id, b.post_count, b.sender, b.nonce, b.tx_hash, b.tx_history, b.batched_at, b.submitted_at, b.block_number,
           b.anchored_at, b.settled_at
    FROM post_chains pc LEFT JOIN batches b ON b.id = pc.batch_id
    WHERE pc.post_hash IN ${sql(keys)} ORDER BY pc.chain_id`;
}

function image(row: PostRow) {
  return row.image_meta && row.image_arweave_id
    ? { arweaveId: row.image_arweave_id, hash: bytesToHex(row.image_hash), mime: 'image/webp', ...row.image_meta }
    : row.image_meta
      ? { arweaveId: null, hash: bytesToHex(row.image_hash), mime: 'image/webp', ...row.image_meta }
      : null;
}

/**
 * GET /posts: most recent posts, newest first. Only public data (the same that is on Arweave and on-chain); never the
 * signer HMAC, the signature or the private intent fields.
 */
export async function recentPosts(sql: Sql, limit: number, before?: number) {
  const rows = await sql<PostRow[]>`
    SELECT post_hash, username, caption, created_at, accepted_at, stored_at, state, post_arweave_id, image_arweave_id, image_hash, image_meta,
           sig_commit, receipt
    FROM posts WHERE state <> 'FAILED' ${before === undefined ? sql`` : sql`AND accepted_at < ${before}`}
    ORDER BY accepted_at DESC, post_hash LIMIT ${limit}`;
  const chains = await chainsFor(sql, rows.map((r) => r.post_hash));
  return rows.map((row) => ({
    postHash: bytesToHex(row.post_hash),
    username: row.username,
    caption: row.caption,
    createdAt: Number(row.created_at),
    acceptedAt: Number(row.accepted_at),
    state: row.state,
    postArweaveId: row.post_arweave_id,
    image: image(row),
    chains: chains.filter((c) => c.post_hash.equals(row.post_hash)).map((c) => ({ chainId: c.chain_id, stage: stageOf(c) })),
  }));
}

/** GET /posts/:postHash: everything public about one post, for the post page (timeline, batches, Merkle proofs). */
export async function postDetail(sql: Sql, postHash: Hex) {
  const key = Buffer.from(hexToBytes(postHash));
  const [row] = await sql<PostRow[]>`
    SELECT post_hash, username, caption, created_at, accepted_at, stored_at, state, post_arweave_id, image_arweave_id, image_hash, image_meta,
           sig_commit, receipt
    FROM posts WHERE post_hash = ${key}`;
  if (!row) throw new ApiError(404, 'not-found', 'unknown postHash');
  const chains = await chainsFor(sql, [key]);
  return {
    postHash,
    username: row.username,
    caption: row.caption,
    createdAt: Number(row.created_at),
    acceptedAt: Number(row.accepted_at),
    storedAt: num(row.stored_at),
    state: row.state,
    postArweaveId: row.post_arweave_id,
    image: image(row),
    sigCommit: bytesToHex(row.sig_commit),
    receipt: row.receipt,
    chains: chains.map((c) => {
      const anchored = c.batch_state === 'ANCHORED' || c.batch_state === 'SETTLED';
      const proof = anchored && c.manifest ? inclusionProof(treeFromManifest(c.manifest), postHash) : null;
      return {
        chainId: c.chain_id,
        stage: stageOf(c),
        state: c.batch_state ?? c.pc_state,
        anchorBy: Number(c.anchor_by),
        batch: c.batch_id
          ? {
              id: Number(c.batch_id),
              root: c.root ? bytesToHex(c.root) : null,
              postCount: c.post_count,
              manifestArweaveId: c.manifest_arweave_id,
              sender: c.sender ? getAddress(bytesToHex(c.sender)) : null,
              nonce: num(c.nonce),
              txHash: c.tx_hash ? bytesToHex(c.tx_hash) : null,
              replacements: Math.max(0, (c.tx_history?.length ?? 0) - 1),
              batchedAt: num(c.batched_at),
              submittedAt: num(c.submitted_at),
              blockNumber: num(c.block_number),
              anchoredAt: num(c.anchored_at),
              settledAt: num(c.settled_at),
            }
          : null,
        proof: proof ? { leafData: proof.leafData, siblings: proof.proof } : null,
      };
    }),
  };
}
