import { ManifestSchema, bytes32ToArweaveId, inclusionProof, manifestRootMatches, treeFromManifest, type Manifest } from '@phi/core';
import type { Address, Hex } from 'viem';
import type { AnchorEvent, ArweaveSource, ChainSource } from './sources.ts';

export type ScanHit = { event: AnchorEvent; leafData: Hex; proof: Hex[] };
export type ScanOutcome = {
  fromBlock: bigint;
  toBlock: bigint;
  /** Every event in the range had a manifest that was fetched, parsed and rebuilt to the event root. */
  complete: boolean;
  /** The chain head is past the end of the requested time window, so no later block can fall inside it. */
  windowClosed: boolean;
  eventsScanned: number;
  hit?: ScanHit;
  problems: string[];
};

/** First block with timestamp >= t (binary search; returns head + 1 if t is in the future). */
export async function blockAtOrAfter(chain: ChainSource, t: bigint): Promise<bigint> {
  const head = await chain.block();
  if (head.timestamp < t) return head.number + 1n;
  let lo = 0n;
  let hi = head.number;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if ((await chain.block(mid)).timestamp >= t) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

/** Last block with timestamp <= t, capped at the head. */
export async function blockAtOrBefore(chain: ChainSource, t: bigint): Promise<bigint> {
  const after = await blockAtOrAfter(chain, t + 1n);
  return after === 0n ? 0n : after - 1n;
}

async function loadManifest(arweave: ArweaveSource, event: AnchorEvent, chainId: number): Promise<Manifest> {
  const id = bytes32ToArweaveId(event.manifestId);
  const parsed = ManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(await arweave.get(id))));
  if (!parsed.success) throw new Error(`manifest ${id} does not match phi.manifest/1`);
  const manifest = parsed.data as Manifest;
  if (manifest.chainId !== chainId) throw new Error(`manifest ${id} is for chain ${manifest.chainId}`);
  if (manifest.root.toLowerCase() !== event.root.toLowerCase() || !manifestRootMatches(manifest)) throw new Error(`manifest ${id} does not rebuild to the anchored root`);
  return manifest;
}

/**
 * Reads the BatchAnchored events of the given trusted senders between two timestamps, fetches each manifest and
 * looks for the post. Used both for discovery without hints and for the bounded scan that can establish an omission.
 */
export async function scanForPost(args: {
  chain: ChainSource;
  chainId: number;
  arweave: ArweaveSource;
  contract: Address;
  senders: Address[];
  postHash: Hex;
  fromTime: bigint;
  toTime: bigint;
}): Promise<ScanOutcome> {
  const { chain, chainId, arweave, contract, senders, postHash, fromTime, toTime } = args;
  const head = await chain.block();
  const fromBlock = await blockAtOrAfter(chain, fromTime);
  const toBlock = await blockAtOrBefore(chain, toTime);
  const outcome: ScanOutcome = { fromBlock, toBlock, complete: true, windowClosed: head.timestamp >= toTime, eventsScanned: 0, problems: [] };

  for (const event of await chain.anchorEvents(contract, senders, fromBlock, toBlock)) {
    outcome.eventsScanned++;
    try {
      const manifest = await loadManifest(arweave, event, chainId);
      const proof = inclusionProof(treeFromManifest(manifest), postHash);
      if (proof && !outcome.hit) outcome.hit = { event, ...proof };
    } catch (error) {
      outcome.complete = false;
      outcome.problems.push(`block ${event.blockNumber}: ${(error as Error).message}`);
    }
  }
  return outcome;
}
