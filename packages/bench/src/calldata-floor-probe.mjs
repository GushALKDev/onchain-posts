#!/usr/bin/env node
// Probes which calldata pricing each chain applies today, with eth_estimateGas of a plain transfer to an EOA
// carrying 0 bytes, 1,000 non-zero bytes and 1,000 zero bytes. Under Prague (EIP-7623) rules the expected values are
// 21,000, 61,000 (floor: 21,000 + 10 x 4,000 tokens) and 31,000 (floor: 21,000 + 10 x 1,000 tokens); without the
// floor, 1,000 non-zero bytes cost 37,000. Clients may pad estimates by a small margin.
//
// Usage: node src/calldata-floor-probe.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.resolve(here, '../results');

const CHAINS = [
  { name: 'Ethereum Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  { name: 'Base Sepolia', rpc: 'https://sepolia.base.org' },
  { name: 'Arbitrum Sepolia', rpc: 'https://sepolia-rollup.arbitrum.io/rpc' },
  { name: 'Ethereum mainnet', rpc: 'https://ethereum-rpc.publicnode.com' },
  { name: 'Base mainnet', rpc: 'https://mainnet.base.org' },
  { name: 'Arbitrum One', rpc: 'https://arb1.arbitrum.io/rpc' },
];
const PAYLOADS = { empty: '0x', nonZero1000: `0x${'11'.repeat(1000)}`, zero1000: `0x${'00'.repeat(1000)}` };

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function probe(chain) {
  const row = { chain: chain.name, rpc: chain.rpc };
  try {
    row.chainId = Number(await rpc(chain.rpc, 'eth_chainId', []));
    row.client = await rpc(chain.rpc, 'web3_clientVersion', []).catch(() => null);
    for (const [label, data] of Object.entries(PAYLOADS)) {
      const tx = { from: '0x000000000000000000000000000000000000bEEF', to: '0x000000000000000000000000000000000000dEaD', data };
      row[label] = await rpc(chain.rpc, 'eth_estimateGas', [tx]).then(Number).catch((e) => `error: ${e.message}`);
    }
  } catch (error) {
    row.error = error.message;
  }
  return row;
}

const rows = [];
for (const chain of CHAINS) rows.push(await probe(chain));

const date = new Date().toISOString().slice(0, 10);
mkdirSync(resultsDir, { recursive: true });
const outFile = path.join(resultsDir, `${date}-calldata-floor-probe.json`);
writeFileSync(outFile, `${JSON.stringify({ schema: 'phi.bench.calldata-probe/1', date, method: 'eth_estimateGas, see header of calldata-floor-probe.mjs', rows }, null, 2)}\n`);
console.table(rows.map(({ chain, chainId, empty, nonZero1000, zero1000, client }) => ({ chain, chainId, empty, nonZero1000, zero1000, client })));
console.log(`written to ${path.relative(path.resolve(here, '../../..'), outFile)}`);
