import { POST_SCHEMA, type PostJson } from '@onchain-posts/core';
import { bytesToHex } from 'viem';
import type { Deps } from '../deps.ts';
import { log, redact } from '../log.ts';
import { APP_NAME, type Storage } from '../storage.ts';

export const MAX_STORAGE_ATTEMPTS = 5;

type Row = {
  post_hash: Buffer;
  username: string;
  caption: string;
  created_at: string;
  image_hash: Buffer;
  image_bytes: Buffer | null;
  image_meta: { bytes: number; width: number; height: number } | null;
  image_arweave_id: string | null;
  attempts: number;
};

/**
 * Uploads the image, then the post JSON, for received posts, one post per transaction. Only stored posts are queued
 * for batching, so anchors never point to missing data (ADR-008). An image uploaded before a failure is not re-uploaded.
 */
export async function storeReceivedPosts(deps: Deps, storage: Storage, maxPosts = 20): Promise<number> {
  let stored = 0;
  for (let i = 0; i < maxPosts; i++) {
    const done = await deps.sql.begin(async (tx) => {
      const [row] = await tx<Row[]>`
        SELECT post_hash, username, caption, created_at, image_hash, image_bytes, image_meta, image_arweave_id, attempts
        FROM posts WHERE state = 'RECEIVED' ORDER BY accepted_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!row) return false;
      const postHash = bytesToHex(row.post_hash);
      try {
        let imageArweaveId = row.image_arweave_id;
        if (row.image_bytes && !imageArweaveId) {
          imageArweaveId = await storage.upload(row.image_bytes, [
            { name: 'Content-Type', value: 'image/webp' },
            { name: 'App-Name', value: APP_NAME },
            { name: 'Type', value: 'post-image' },
            { name: 'Image-Hash', value: bytesToHex(row.image_hash) },
          ]);
          await tx`UPDATE posts SET image_arweave_id = ${imageArweaveId} WHERE post_hash = ${row.post_hash}`;
        }
        const postJson: PostJson = {
          schema: POST_SCHEMA,
          type: 'post',
          username: row.username,
          caption: row.caption,
          createdAt: Number(row.created_at),
          image: row.image_meta && imageArweaveId ? { arweaveId: imageArweaveId, hash: bytesToHex(row.image_hash), mime: 'image/webp', ...row.image_meta } : null,
          postHash,
        };
        // No username tag: we do not publish an indexable user dimension (ADR-014).
        const postArweaveId = await storage.upload(new TextEncoder().encode(JSON.stringify(postJson)), [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: APP_NAME },
          { name: 'Schema', value: POST_SCHEMA },
          { name: 'Type', value: 'post' },
          { name: 'Post-Hash', value: postHash },
        ]);
        await tx`UPDATE posts SET state = 'STORED', post_arweave_id = ${postArweaveId}, image_bytes = NULL, stored_at = ${deps.now()}, updated_at = now() WHERE post_hash = ${row.post_hash}`;
        await tx`UPDATE post_chains SET state = 'QUEUED', queued_at = ${deps.now()} WHERE post_hash = ${row.post_hash} AND state = 'WAITING'`;
        stored++;
      } catch (error) {
        const attempts = row.attempts + 1;
        const message = redact((error as Error).message);
        await tx`UPDATE posts SET attempts = ${attempts}, last_error = ${message}, state = ${attempts >= MAX_STORAGE_ATTEMPTS ? 'FAILED' : 'RECEIVED'} WHERE post_hash = ${row.post_hash}`;
        log.warn('storage upload failed', { postHash, attempts, error: message });
      }
      return true;
    });
    if (!done) break;
  }
  return stored;
}
