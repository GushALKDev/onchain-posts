import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  POST_ANCHOR_ADDRESS,
  bytes32ToArweaveId,
  type TrustedKey,
} from '@phi/core';
import { concat, createPublicClient, createTestClient, createWalletClient, defineChain, http, keccak256, toBytes, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { chainSourceFromClient, type ArweaveSource, type ChainSource } from '../src/index.ts';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const SALT = keccak256(toBytes('phi-onchain-posts/PostAnchor/v1'));
const ARTIFACT = new URL('../../../contracts/out/PostAnchor.sol/PostAnchor.json', import.meta.url);

export type TestChain = {
  chainId: number;
  url: string;
  publicClient: PublicClient;
  source: ChainSource;
  accounts: { relayer: PrivateKeyAccount; outsider: PrivateKeyAccount; revoked: PrivateKeyAccount };
  wallet: (account: PrivateKeyAccount) => ReturnType<typeof createWalletClient>;
  increaseTime: (seconds: number) => Promise<void>;
  head: () => Promise<number>;
  stop: () => void;
};

/** Starts an anvil node with the given chain ID and deploys PostAnchor at its real CREATE2 address. */
export async function startChain(chainId: number): Promise<TestChain> {
  const dir = mkdtempSync(path.join(tmpdir(), 'phi-verifier-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const url = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn('anvil', ['--chain-id', String(chainId), '--port', String(port), '--silent', '--config-out', path.join(dir, 'anvil.json')], { stdio: 'ignore' });

  const chain = defineChain({ id: chainId, name: `test-${chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const publicClient = createPublicClient({ chain, transport: http(url) }) as PublicClient;
  for (let i = 0; ; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (i > 100) throw new Error('anvil did not start');
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const keys: Hex[] = JSON.parse(readFileSync(path.join(dir, 'anvil.json'), 'utf8')).private_keys;
  const [deployer, relayer, outsider, revoked] = keys.slice(0, 4).map((k) => privateKeyToAccount(k)) as [PrivateKeyAccount, PrivateKeyAccount, PrivateKeyAccount, PrivateKeyAccount];
  const wallet = (account: PrivateKeyAccount) => createWalletClient({ account, chain, transport: http(url) });
  const testClient = createTestClient({ chain, mode: 'anvil', transport: http(url) });

  const initCode = JSON.parse(readFileSync(ARTIFACT, 'utf8')).bytecode.object as Hex;
  const hash = await wallet(deployer).sendTransaction({ to: CREATE2_DEPLOYER, data: concat([SALT, initCode]) });
  await publicClient.waitForTransactionReceipt({ hash });
  if (!(await publicClient.getCode({ address: POST_ANCHOR_ADDRESS }))) throw new Error('PostAnchor did not land at its predicted address');

  return {
    chainId,
    url,
    publicClient,
    source: chainSourceFromClient(publicClient),
    accounts: { relayer, outsider, revoked },
    wallet,
    increaseTime: async (seconds) => {
      await testClient.increaseTime({ seconds });
      await testClient.mine({ blocks: 1 });
    },
    head: async () => Number((await publicClient.getBlock()).timestamp),
    stop: () => {
      anvil.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** In-memory Arweave: content-addressed IDs, plus a way to tamper with stored items. */
export class MemoryArweave implements ArweaveSource {
  private readonly items = new Map<string, Uint8Array>();
  put(bytes: Uint8Array): string {
    const id = bytes32ToArweaveId(keccak256(bytes));
    this.items.set(id, bytes);
    return id;
  }
  replace(id: string, bytes: Uint8Array) {
    this.items.set(id, bytes);
  }
  delete(id: string) {
    this.items.delete(id);
  }
  async get(id: string): Promise<Uint8Array> {
    const bytes = this.items.get(id);
    if (!bytes) throw new Error(`not found on gateway: ${id}`);
    return bytes;
  }
}

/** Trust root for the tests: one relayer per chain, a revoked relayer and one receipt key. */
export function trustedKeysFor(chains: TestChain[], receiptKey: PrivateKeyAccount): TrustedKey[] {
  const window = { validFrom: '2026-01-01T00:00:00Z', revokedAt: null, note: 'test' };
  return [
    ...chains.flatMap((c): TrustedKey[] => [
      { role: 'relayer', chainId: c.chainId, address: c.accounts.relayer.address, ...window },
      { role: 'relayer', chainId: c.chainId, address: c.accounts.revoked.address, ...window, revokedAt: '2026-02-01T00:00:00Z' },
    ]),
    { role: 'receipt', chainId: null, address: receiptKey.address, ...window },
  ];
}

/** Serves a MemoryArweave over HTTP like a gateway (GET /<id>), for the CLI test. */
export async function serveArweave(arweave: MemoryArweave): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    arweave
      .get((req.url ?? '/').slice(1))
      .then((bytes) => res.writeHead(200).end(bytes))
      .catch(() => res.writeHead(404).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('gateway did not start');
  return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}
