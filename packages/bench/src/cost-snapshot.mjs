#!/usr/bin/env node
// Money conversion (ADR-001). Turns the measured gas into USD per post with a mainnet price snapshot:
// - Ethereum: gasUsed (Prague rules) x (base fee + suggested priority fee).
// - Base: gasUsed (Prague rules) x (L2 base fee + suggested priority fee) + L1 data fee from GasPriceOracle.getL1Fee.
// - Arbitrum: (gasUsed without the calldata floor + L1 component from NodeInterface.gasEstimateL1Component) x L2 base fee.
// - ETH/USD from the Chainlink ETH / USD feed on Ethereum mainnet; storage from the Turbo rates endpoint.
//
// Usage: node src/cost-snapshot.mjs   (requires cast on PATH and the two gas results files of the same date)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const resultsDir = path.resolve(here, '../results');

const RPC = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  base: 'https://mainnet.base.org',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
};
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const BASE_GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F';
const ARBITRUM_NODE_INTERFACE = '0x00000000000000000000000000000000000000C8';
const TURBO_RATES = 'https://turbo.ardrive.io/v1/rates';
const TURBO_PRICE_BYTES = 'https://turbo.ardrive.io/v1/price/bytes/';
const ANCHOR_TARGET = '0x36b5D5F0D176b96013678FC69C34038897fAF382'; // predicted PostAnchor address (ADR-009)

const BATCH_SIZES = [1, 10, 100, 500, 1000];
const GIB = 2 ** 30;
// Storage sizes (bytes). Image cap from ADR-003; post JSON and manifest entry are Estimates (ADR-006, ADR-014).
const IMAGE_BYTES = 95 * 1024;
const POST_JSON_BYTES = 1400; // Estimate: ADR-014 fields (about 400 B) + a 1,000-byte caption
const MANIFEST_ENTRY_BYTES = 209; // Estimate from ADR-006
const MANIFEST_HEADER_BYTES = 150; // Estimate: schema, chainId, root, leafEncoding

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let valueCounter = 0;
const hex32 = () => `0x${createHash('sha256').update(`phi-cost-${valueCounter++}`).digest('hex')}`;

async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const castCall = (url, to, sig, args = []) => run('cast', ['call', to, sig, ...args, '--rpc-url', url]).split('\n').map((line) => line.split(' ')[0]);

// Minimal RLP encoder, enough for an unsigned EIP-1559 transaction.
function rlp(input) {
  const prefix = (len, offset) => {
    if (len < 56) return Buffer.from([offset + len]);
    const hex = len.toString(16).padStart(Math.ceil(len.toString(16).length / 2) * 2, '0');
    return Buffer.concat([Buffer.from([offset + 55 + hex.length / 2]), Buffer.from(hex, 'hex')]);
  };
  if (Array.isArray(input)) {
    const payload = Buffer.concat(input.map(rlp));
    return Buffer.concat([prefix(payload.length, 0xc0), payload]);
  }
  let bytes;
  if (typeof input === 'bigint') bytes = input === 0n ? Buffer.alloc(0) : Buffer.from(input.toString(16).padStart(Math.ceil(input.toString(16).length / 2) * 2, '0'), 'hex');
  else bytes = Buffer.from(input.slice(2), 'hex');
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return Buffer.concat([prefix(bytes.length, 0x80), bytes]);
}

const unsignedEip1559 = ({ chainId, maxPriorityFee, maxFee, gasLimit, to, data }) =>
  `0x02${rlp([BigInt(chainId), 0n, maxPriorityFee, maxFee, BigInt(gasLimit), to, 0n, data, []]).toString('hex')}`;

// One representative transaction per variant and batch size; gas comes from the measured results.
function transactions() {
  const tx = [];
  const anchorData = (n) => run('cast', ['calldata', 'anchor(bytes32,bytes32,uint32)', hex32(), hex32(), String(n)]);
  for (const n of BATCH_SIZES) {
    tx.push({ variant: 'ours', n, data: anchorData(n) });
    tx.push({ variant: 'ours_lite', n, data: anchorData(n) });
    tx.push({ variant: 'B2', n, data: run('cast', ['calldata', 'publishBatch(bytes32[])', `[${Array.from({ length: n }, hex32).join(',')}]`]) });
  }
  tx.push({ variant: 'B1', n: 1, perPost: true, data: run('cast', ['calldata', 'publish(bytes32)', hex32()]) });
  for (const [variant, bytes] of [['B0_short_caption', 100], ['B0_long_caption', 1000]]) {
    tx.push({ variant, n: 1, perPost: true, data: run('cast', ['calldata', 'publish(bytes32,string,string,bytes32)', hex32(), 'ana_example', 'a'.repeat(bytes), hex32()]) });
  }
  return tx;
}

function latestResults(hardfork) {
  const files = readdirSync(resultsDir).filter((f) => f.endsWith(`-gas-local-${hardfork}.json`)).sort();
  if (!files.length) throw new Error(`run gas-bench.mjs --hardfork ${hardfork} first`);
  return { file: files.at(-1), data: JSON.parse(readFileSync(path.join(resultsDir, files.at(-1)), 'utf8')) };
}

const batchGas = (results, variant, n) => {
  const v = results.variants[variant];
  return v.model === 'one transaction per post' ? v.gasPerPost.mean : v.byBatchSize[n].gasPerBatch;
};

async function main() {
  const prague = latestResults('prague');
  const cancun = latestResults('cancun');

  // Price snapshot.
  const [, answer, , updatedAt] = castCall(RPC.ethereum, CHAINLINK_ETH_USD, 'latestRoundData()(uint80,int256,uint256,uint256,uint80)');
  const ethUsd = Number(answer) / 1e8;
  const snapshot = { ethUsd, ethUsdUpdatedAt: new Date(Number(updatedAt) * 1000).toISOString() };
  for (const chain of Object.keys(RPC)) {
    const block = await rpc(RPC[chain], 'eth_getBlockByNumber', ['latest', false]);
    snapshot[chain] = {
      block: Number(block.number),
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      baseFeeWei: BigInt(block.baseFeePerGas).toString(),
      priorityFeeWei: chain === 'arbitrum' ? '0' : BigInt(await rpc(RPC[chain], 'eth_maxPriorityFeePerGas', [])).toString(),
    };
  }
  const weiToUsd = (wei) => (Number(wei) / 1e18) * ethUsd;

  // Anchoring cost per transaction on each chain.
  const anchoring = {};
  for (const t of transactions()) {
    const gasPrague = batchGas(prague.data, t.variant, t.n);
    const gasCancun = batchGas(cancun.data, t.variant, t.n);
    const eth = BigInt(snapshot.ethereum.baseFeeWei) + BigInt(snapshot.ethereum.priorityFeeWei);
    const base = BigInt(snapshot.base.baseFeeWei) + BigInt(snapshot.base.priorityFeeWei);
    const arbBaseFee = BigInt(snapshot.arbitrum.baseFeeWei);

    const unsigned = unsignedEip1559({ chainId: 8453, maxPriorityFee: BigInt(snapshot.base.priorityFeeWei), maxFee: 2n * base, gasLimit: Math.ceil(gasPrague * 1.2), to: ANCHOR_TARGET, data: t.data });
    const [baseL1FeeWei] = castCall(RPC.base, BASE_GAS_PRICE_ORACLE, 'getL1Fee(bytes)(uint256)', [unsigned]);
    const [arbL1Gas] = castCall(RPC.arbitrum, ARBITRUM_NODE_INTERFACE, 'gasEstimateL1Component(address,bool,bytes)(uint64,uint256,uint256)', [ANCHOR_TARGET, 'false', t.data]);

    const perTx = {
      ethereum: weiToUsd(BigInt(gasPrague) * eth),
      base: weiToUsd(BigInt(gasPrague) * base + BigInt(baseL1FeeWei)),
      arbitrum: weiToUsd((BigInt(gasCancun) + BigInt(arbL1Gas)) * arbBaseFee),
    };
    const divisor = t.perPost ? 1 : t.n;
    anchoring[t.variant] ??= {};
    const sizes = t.perPost ? BATCH_SIZES : [t.n];
    for (const n of sizes) {
      anchoring[t.variant][n] = {
        usdPerPost: Object.fromEntries(Object.entries(perTx).map(([c, usd]) => [c, usd / divisor])),
        inputs: { gasPrague, gasCancun, calldataBytes: (t.data.length - 2) / 2, baseL1FeeWei, arbitrumL1Gas: Number(arbL1Gas) },
      };
    }
  }

  // Storage cost (list price; the free tier covers items up to 105 KiB within a 10 MiB lifetime allowance, ADR-002).
  const rates = await (await fetch(TURBO_RATES)).json();
  const wincPerGiB = Number(rates.winc);
  const usdPerWinc = rates.fiat.usd / wincPerGiB;
  const perItemWinc = Number(rates.perDataItemFeeWinc);
  const itemUsd = (bytes) => (Math.ceil((bytes * wincPerGiB) / GIB) + perItemWinc) * usdPerWinc;
  const checkWinc = Number((await (await fetch(TURBO_PRICE_BYTES + IMAGE_BYTES)).json()).winc);
  const storage = {
    usdPerGiB: rates.fiat.usd,
    perDataItemFeeWinc: perItemWinc,
    perDataItemFeeUsd: perItemWinc * usdPerWinc,
    imageUsd: itemUsd(IMAGE_BYTES),
    imagePriceEndpointUsd: checkWinc * usdPerWinc,
    postJsonUsd: itemUsd(POST_JSON_BYTES),
    manifestSharePerPostUsd: Object.fromEntries(BATCH_SIZES.map((n) => [n, itemUsd(MANIFEST_HEADER_BYTES + MANIFEST_ENTRY_BYTES * n) / n])),
  };

  // End-to-end cost of one post with a 95 KiB image anchored with ours, per chain and on all three.
  const endToEnd = {};
  for (const n of BATCH_SIZES) {
    const perChain = Object.fromEntries(
      Object.keys(RPC).map((c) => [c, storage.imageUsd + storage.postJsonUsd + storage.manifestSharePerPostUsd[n] + anchoring.ours[n].usdPerPost[c]]),
    );
    const allThree = storage.imageUsd + storage.postJsonUsd + Object.keys(RPC).reduce((sum, c) => sum + storage.manifestSharePerPostUsd[n] + anchoring.ours[n].usdPerPost[c], 0);
    endToEnd[n] = { ...perChain, allThreeChains: allThree };
  }

  const date = new Date().toISOString().slice(0, 10);
  const result = {
    schema: 'onchain-posts.bench.cost/1',
    date,
    inputs: { gasPrague: prague.file, gasCancun: cancun.file },
    sources: { rpc: RPC, chainlinkEthUsd: CHAINLINK_ETH_USD, baseGasPriceOracle: `${BASE_GAS_PRICE_ORACLE} getL1Fee(bytes)`, arbitrumNodeInterface: `${ARBITRUM_NODE_INTERFACE} gasEstimateL1Component(address,bool,bytes)`, turbo: TURBO_RATES },
    assumptions: {
      imageBytes: IMAGE_BYTES,
      postJsonBytes: `${POST_JSON_BYTES} (Estimate)`,
      manifestEntryBytes: `${MANIFEST_ENTRY_BYTES} (Estimate)`,
      arbitrumExecutionGas: 'cancun-rules gas (no EIP-7623 floor), cross-checked against eth_estimateGas with state override on Arbitrum One',
      storage: 'Turbo list price; the free tier (items up to 105 KiB, 10 MiB lifetime allowance per wallet) is ignored',
    },
    snapshot,
    storage,
    anchoring,
    endToEnd,
  };
  const outFile = path.join(resultsDir, `${date}-cost-snapshot.json`);
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

  const usd = (x) => (x < 0.0001 ? x.toExponential(2) : x.toFixed(4));
  console.log(`ETH/USD ${ethUsd} | base fee (gwei) ETH ${Number(snapshot.ethereum.baseFeeWei) / 1e9}, Base ${Number(snapshot.base.baseFeeWei) / 1e9}, Arbitrum ${Number(snapshot.arbitrum.baseFeeWei) / 1e9}`);
  console.log(`\nAnchoring USD per post, ours:`);
  for (const n of BATCH_SIZES) console.log(`  N=${n}: ${Object.entries(anchoring.ours[n].usdPerPost).map(([c, v]) => `${c} ${usd(v)}`).join(' | ')}`);
  console.log(`\nStorage: image ${usd(storage.imageUsd)}, post JSON ${usd(storage.postJsonUsd)}, per-item fee ${usd(storage.perDataItemFeeUsd)}`);
  console.log(`End-to-end post with image, N=100: ${Object.entries(endToEnd[100]).map(([c, v]) => `${c} ${usd(v)}`).join(' | ')}`);
  console.log(`\nwritten to ${path.relative(repoRoot, outFile)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
