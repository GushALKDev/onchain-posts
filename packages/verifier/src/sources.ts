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

/** ChainSource over a viem public client; log queries are split into ranges that public RPCs accept. */
export function chainSourceFromClient(client: PublicClient, maxBlockRange = 10_000n): ChainSource {
  return {
    anchoredAt: (contract, sender, root) => client.readContract({ address: contract, abi: postAnchorAbi, functionName: 'anchoredAt', args: [sender, root] }),
    verifyPost: (contract, sender, root, leafData, proof) =>
      client.readContract({ address: contract, abi: postAnchorAbi, functionName: 'verifyPost', args: [sender, root, leafData, proof] }),
    async anchorEvents(contract, senders, fromBlock, toBlock) {
      if (senders.length === 0 || fromBlock > toBlock) return [];
      const events: AnchorEvent[] = [];
      for (let start = fromBlock; start <= toBlock; start += maxBlockRange) {
        const end = start + maxBlockRange - 1n < toBlock ? start + maxBlockRange - 1n : toBlock;
        const logs = await client.getLogs({ address: contract, event: batchAnchored, args: { sender: senders }, fromBlock: start, toBlock: end, strict: true });
        for (const log of logs) {
          events.push({ sender: log.args.sender, root: log.args.root, manifestId: log.args.manifestId, count: log.args.count, blockNumber: log.blockNumber });
        }
      }
      return events;
    },
    async block(number) {
      const block = number === undefined ? await client.getBlock() : await client.getBlock({ blockNumber: number });
      return { number: block.number, timestamp: block.timestamp };
    },
  };
}

export function gatewaySource(gatewayUrl: string): ArweaveSource {
  const base = gatewayUrl.replace(/\/+$/, '');
  return {
    async get(id) {
      const res = await fetch(`${base}/${id}`);
      if (!res.ok) throw new Error(`gateway returned ${res.status} for ${id}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

export function createPublicSources({ rpcUrls, gateway }: { rpcUrls: Record<number, string>; gateway: string }): Sources {
  const chains: Record<number, ChainSource> = {};
  for (const [chainId, url] of Object.entries(rpcUrls)) {
    chains[Number(chainId)] = chainSourceFromClient(createPublicClient({ transport: http(url) }));
  }
  return { arweave: gatewaySource(gateway), chains };
}
