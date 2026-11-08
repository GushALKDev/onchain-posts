import { describe, expect, it } from 'vitest';
import { blockAtOrAfter, blockAtOrBefore } from '../src/scan.ts';
import { chainSourceFromClient, gatewaySource, type ChainSource } from '../src/sources.ts';
import { MemoryArweave, serveArweave } from './harness.ts';

/** A chain of `length` blocks, one every 2 s from t = 1000, whose RPC has pruned everything below `prunedBelow`. */
function prunedChain(length: number, prunedBelow: number): ChainSource & { reads: number[] } {
  const reads: number[] = [];
  return {
    reads,
    block: async (n?: bigint) => {
      const number = n ?? BigInt(length - 1);
      reads.push(Number(number));
      if (number < BigInt(prunedBelow)) throw new Error(`pruned history unavailable: requested ${number}`);
      return { number, timestamp: 1000n + number * 2n };
    },
    anchoredAt: async () => 0n,
    verifyPost: async () => false,
    anchorEvents: async () => [],
  };
}

describe('block search by timestamp', () => {
  it('finds a recent block without reading pruned history', async () => {
    const chain = prunedChain(50_000_000, 46_500_000);
    const target = 1000n + 49_999_000n * 2n + 1n; // between blocks 49,999,000 and 49,999,001
    expect(await blockAtOrAfter(chain, target)).toBe(49_999_001n);
    expect(await blockAtOrBefore(chain, target)).toBe(49_999_000n);
    expect(Math.min(...chain.reads)).toBeGreaterThanOrEqual(46_500_000);
  });

  it('handles the edges: a future time, the head itself and the genesis side', async () => {
    const chain = prunedChain(100, 0);
    expect(await blockAtOrAfter(chain, 1000n + 99n * 2n + 1n)).toBe(100n); // after the head
    expect(await blockAtOrAfter(chain, 1000n + 99n * 2n)).toBe(99n); // exactly the head
    expect(await blockAtOrAfter(chain, 0n)).toBe(0n); // before genesis
    expect(await blockAtOrAfter(chain, 1001n)).toBe(1n);
  });
});

describe('log queries', () => {
  it('halves the block range when the provider rejects it as too large, and covers every block once', async () => {
    const ranges: [bigint, bigint][] = [];
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 200n) throw new Error('eth_getLogs is limited to a 200 range');
        ranges.push([fromBlock, toBlock]);
        return [];
      },
    };
    const source = chainSourceFromClient(client as never);
    await source.anchorEvents('0xD0fB2A7F1D12C5AF80E49B31Bcb1B4983AD7C5dB', ['0x1111111111111111111111111111111111111111'], 1_000n, 3_499n);
    expect(ranges.every(([a, b]) => b - a + 1n <= 200n)).toBe(true);
    expect(ranges[0]![0]).toBe(1_000n);
    expect(ranges.at(-1)![1]).toBe(3_499n);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1n);
  });

  it('does not retry errors that are not about the range', async () => {
    const client = { getLogs: async () => Promise.reject(new Error('connection refused')) };
    await expect(chainSourceFromClient(client as never).anchorEvents('0xD0fB2A7F1D12C5AF80E49B31Bcb1B4983AD7C5dB', ['0x1111111111111111111111111111111111111111'], 0n, 10n)).rejects.toThrow('connection refused');
  });
});

describe('gateways', () => {
  it('tries the gateways in order and returns the first copy served', async () => {
    const empty = await serveArweave(new MemoryArweave());
    const store = new MemoryArweave();
    const id = store.put(new TextEncoder().encode('content'));
    const full = await serveArweave(store);
    try {
      expect(new TextDecoder().decode(await gatewaySource([empty.url, full.url]).get(id))).toBe('content');
      await expect(gatewaySource([empty.url]).get(id)).rejects.toThrow(/no gateway served/);
    } finally {
      empty.close();
      full.close();
    }
  });
});
