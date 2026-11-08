import { postAnchorAbi } from '@phi/core';
import { createPublicClient, getAbiItem, http, type Address, type Hex, type PublicClient } from 'viem';

export type AnchorEvent = { sender: Address; root: Hex; manifestId: Hex; count: number; blockNumber: bigint };
export type BlockInfo = { number: bigint; timestamp: bigint };

/** Read-only access to one chain. Everything the verifier learns from a chain goes through this interface. */
export interface ChainSource {
  anchoredAt(contract: Address, sender: Address, root: Hex): Promise<bigint>;
  verifyPost(contract: Address, sender: Address, root: Hex, leafData: Hex, proof: Hex[]): Promise<boolean>;
  anchorEvents(contract: Address, senders: Address[], fromBlock: bigint, toBlock: bigint): Promise<AnchorEvent[]>;
  /** Latest block when `number` is undefined. */
  block(number?: bigint): Promise<BlockInfo>;
}

/** Read-only access to Arweave data by ID. */
export interface ArweaveSource {
  get(id: string): Promise<Uint8Array>;
}

export type Sources = { arweave: ArweaveSource; chains: Record<number, ChainSource> };

const batchAnchored = getAbiItem({ abi: postAnchorAbi, name: 'BatchAnchored' });

const RANGE_REJECTED = /range|limit|too many|exceed/i;

/**
 * ChainSource over a viem public client. Log queries are split into block ranges; when a provider rejects a range as
 * too large (public RPCs set different limits, e.g. 200 blocks), the range is halved and the query retried.
 */
export function chainSourceFromClient(client: PublicClient, maxBlockRange = 10_000n): ChainSource {
  return {
    anchoredAt: (contract, sender, root) => client.readContract({ address: contract, abi: postAnchorAbi, functionName: 'anchoredAt', args: [sender, root] }),
    verifyPost: (contract, sender, root, leafData, proof) =>
      client.readContract({ address: contract, abi: postAnchorAbi, functionName: 'verifyPost', args: [sender, root, leafData, proof] }),
    async anchorEvents(contract, senders, fromBlock, toBlock) {
      if (senders.length === 0 || fromBlock > toBlock) return [];
      const events: AnchorEvent[] = [];
      let range = maxBlockRange;
      let start = fromBlock;
      while (start <= toBlock) {
        const end = start + range - 1n < toBlock ? start + range - 1n : toBlock;
        let logs;
        try {
          logs = await client.getLogs({ address: contract, event: batchAnchored, args: { sender: senders }, fromBlock: start, toBlock: end, strict: true });
        } catch (error) {
          if (range > 1n && RANGE_REJECTED.test((error as Error).message)) {
            range /= 2n;
            continue;
          }
          throw error;
        }
        for (const log of logs) {
          events.push({ sender: log.args.sender, root: log.args.root, manifestId: log.args.manifestId, count: log.args.count, blockNumber: log.blockNumber });
        }
        start = end + 1n;
      }
      return events;
    },
    async block(number) {
      const block = number === undefined ? await client.getBlock() : await client.getBlock({ blockNumber: number });
      return { number: block.number, timestamp: block.timestamp };
    },
  };
}

/**
 * Public Arweave gateways tried in order. Turbo uploads are served first by ar.io gateways that read Turbo's cache;
 * arweave.net can lag by minutes (ADR-008). Content is checked by hash, so no gateway needs to be trusted.
 */
export const DEFAULT_GATEWAYS = ['https://turbo-gateway.com', 'https://ardrive.net', 'https://arweave.net'];

export function gatewaySource(gateways: string | string[]): ArweaveSource {
  const bases = (Array.isArray(gateways) ? gateways : [gateways]).map((g) => g.replace(/\/+$/, ''));
  return {
    async get(id) {
      const failures: string[] = [];
      for (const base of bases) {
        try {
          const res = await fetch(`${base}/${id}`);
          if (res.ok) return new Uint8Array(await res.arrayBuffer());
          failures.push(`${new URL(base).host} ${res.status}`);
        } catch (error) {
          failures.push(`${base}: ${(error as Error).message}`);
        }
      }
      throw new Error(`no gateway served ${id} (${failures.join(', ')})`);
    },
  };
}

export function createPublicSources({ rpcUrls, gateway = DEFAULT_GATEWAYS }: { rpcUrls: Record<number, string>; gateway?: string | string[] }): Sources {
  const chains: Record<number, ChainSource> = {};
  for (const [chainId, url] of Object.entries(rpcUrls)) {
    chains[Number(chainId)] = chainSourceFromClient(createPublicClient({ transport: http(url) }));
  }
  return { arweave: gatewaySource(gateway), chains };
}
