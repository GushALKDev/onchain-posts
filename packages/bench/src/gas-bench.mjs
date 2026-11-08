#!/usr/bin/env node
// Gas benchmark (ADR-001). Deploys PostAnchor and the baselines B0, B1, B2 and ours-lite on a local anvil node
// with Ethereum L1 rules (Prague hardfork), sends real transactions and reads gasUsed from the receipts.
// The L1 data fee that L2s charge on top is NOT included; cost-snapshot.mjs adds it from mainnet oracles.
//
// Usage: node src/gas-bench.mjs [--hardfork prague|cancun]   (requires anvil, forge and cast on PATH)
//   prague (default): Ethereum mainnet and Base rules, including the EIP-7623 calldata floor.
//   cancun: standard calldata pricing without the floor, used as the proxy for Arbitrum execution gas.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const contractsDir = path.join(repoRoot, 'contracts');
const resultsDir = path.resolve(here, '../results');

const hardforkFlag = process.argv.indexOf('--hardfork');
const HARDFORK = hardforkFlag === -1 ? 'prague' : process.argv[hardforkFlag + 1];
const BATCH_SIZES = [1, 10, 100, 500, 1000];
// B0 and B1 send one transaction per post and every post costs the same, so a sample replaces N transactions.
const PER_POST_SAMPLES = 10;
const USERNAME = 'ana_example';
const SHORT_CAPTION_BYTES = 100;
const LONG_CAPTION_BYTES = 1000;

const tmp = mkdtempSync(path.join(tmpdir(), 'phi-gas-bench-'));
const port = 18545 + Math.floor(Math.random() * 1000);
const rpcUrl = `http://127.0.0.1:${port}`;

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Deterministic 32-byte values so that every run reproduces the same calldata and therefore the same gas.
let valueCounter = 0;
const hex32 = () => `0x${createHash('sha256').update(`phi-bench-${valueCounter++}`).digest('hex')}`;
const caption = (bytes) => 'a'.repeat(bytes);

function toolVersion(tool) {
  return run(tool, ['--version']).split('\n')[0];
}

async function startAnvil() {
  const configPath = path.join(tmp, 'anvil.json');
  const anvil = spawn('anvil', ['--hardfork', HARDFORK, '--port', String(port), '--silent', '--config-out', configPath], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      run('cast', ['chain-id', '--rpc-url', rpcUrl]);
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return { anvil, privateKey: config.private_keys[0] };
    } catch {
      await sleep(100);
    }
  }
  anvil.kill();
  throw new Error('anvil did not start');
}

function deploy(target, privateKey) {
  const out = run('forge', ['create', target, '--rpc-url', rpcUrl, '--private-key', privateKey, '--broadcast', '--json'], { cwd: contractsDir });
  return JSON.parse(out.slice(out.indexOf('{'))).deployedTo;
}

function calldataStats(calldata) {
  const bytes = Buffer.from(calldata.slice(2), 'hex');
  const zeroBytes = bytes.filter((b) => b === 0).length;
  return { calldataBytes: bytes.length, zeroBytes };
}

function send(to, sig, args, privateKey) {
  const calldata = run('cast', ['calldata', sig, ...args]);
  const receipt = JSON.parse(run('cast', ['send', to, '--data', calldata, '--rpc-url', rpcUrl, '--private-key', privateKey, '--json']));
  if (Number(receipt.status) !== 1) throw new Error(`transaction reverted: ${sig}`);
  const logDataBytes = receipt.logs.reduce((sum, log) => sum + (log.data.length - 2) / 2, 0);
  const topics = receipt.logs.reduce((sum, log) => sum + log.topics.length, 0);
  return { gasUsed: Number(receipt.gasUsed), ...calldataStats(calldata), logDataBytes, topics };
}

function perPostVariant(description, sendOne) {
  const samples = Array.from({ length: PER_POST_SAMPLES }, () => sendOne());
  const gas = samples.map((s) => s.gasUsed);
  return {
    description,
    model: 'one transaction per post',
    samples: samples.length,
    gasPerPost: { mean: Math.round(gas.reduce((a, b) => a + b, 0) / gas.length), min: Math.min(...gas), max: Math.max(...gas) },
    calldataBytesPerPost: samples[0].calldataBytes,
    logDataBytesPerPost: samples[0].logDataBytes,
    byBatchSize: Object.fromEntries(BATCH_SIZES.map((n) => [n, { transactions: n, gasPerPost: Math.round(gas.reduce((a, b) => a + b, 0) / gas.length) }])),
  };
}

function batchVariant(description, sendBatch) {
  const byBatchSize = {};
  for (const n of BATCH_SIZES) {
    const r = sendBatch(n);
    byBatchSize[n] = {
      transactions: 1,
      gasPerBatch: r.gasUsed,
      gasPerPost: Math.round(r.gasUsed / n),
      calldataBytes: r.calldataBytes,
      zeroCalldataBytes: r.zeroBytes,
      logDataBytes: r.logDataBytes,
      onChainBytesPerPost: Math.round((r.calldataBytes + r.logDataBytes) / n),
    };
  }
  return { description, model: 'one transaction per batch', byBatchSize };
}

// Smallest N for which a constant per-batch cost beats a batch variant whose cost grows with N (binary search on real txs).
function crossoverAgainstGrowing(constantGas, sendBatch, maxN = 1000) {
  let lo = 1;
  let hi = maxN;
  const probes = {};
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    probes[mid] = sendBatch(mid).gasUsed;
    if (constantGas < probes[mid]) hi = mid;
    else lo = mid + 1;
  }
  return { n: lo, constantGas, probes };
}

const meanBatchGas = (variant) => Math.round(BATCH_SIZES.reduce((sum, n) => sum + variant.byBatchSize[n].gasPerBatch, 0) / BATCH_SIZES.length);

function markdownTable(variants) {
  const header = `| Variant | ${BATCH_SIZES.map((n) => `N = ${n}`).join(' | ')} |`;
  const sep = `| ------- | ${BATCH_SIZES.map(() => '---').join(' | ')} |`;
  const rows = Object.entries(variants).map(([name, v]) => `| ${name} | ${BATCH_SIZES.map((n) => v.byBatchSize[n].gasPerPost.toLocaleString('en-US')).join(' | ')} |`);
  return [header, sep, ...rows].join('\n');
}

async function main() {
  const { anvil, privateKey } = await startAnvil();
  try {
    run('forge', ['build'], { cwd: contractsDir });
    const addr = {
      ours: deploy('src/PostAnchor.sol:PostAnchor', privateKey),
      oursLite: deploy('bench/OursLite.sol:OursLite', privateKey),
      b0: deploy('bench/B0Naive.sol:B0Naive', privateKey),
      b1: deploy('bench/B1EventPerPost.sol:B1EventPerPost', privateKey),
      b2: deploy('bench/B2HashList.sol:B2HashList', privateKey),
    };

    const publishB0 = (captionBytes) => () =>
      send(addr.b0, 'publish(bytes32,string,string,bytes32)', [hex32(), USERNAME, caption(captionBytes), hex32()], privateKey);
    const anchorArgs = (n) => [hex32(), hex32(), String(n)];

    const variants = {
      B0_short_caption: perPostVariant(`B0 naive storage, caption ${SHORT_CAPTION_BYTES} bytes`, publishB0(SHORT_CAPTION_BYTES)),
      B0_long_caption: perPostVariant(`B0 naive storage, caption ${LONG_CAPTION_BYTES} bytes`, publishB0(LONG_CAPTION_BYTES)),
      B1: perPostVariant('B1 one event per post', () => send(addr.b1, 'publish(bytes32)', [hex32()], privateKey)),
      B2: batchVariant('B2 hash list in one event per batch', (n) =>
        send(addr.b2, 'publishBatch(bytes32[])', [`[${Array.from({ length: n }, hex32).join(',')}]`], privateKey)),
      ours_lite: batchVariant('ours-lite: root in an event, no storage', (n) =>
        send(addr.oursLite, 'anchor(bytes32,bytes32,uint32)', anchorArgs(n), privateKey)),
      ours: batchVariant('ours: PostAnchor, root + one storage slot', (n) => send(addr.ours, 'anchor(bytes32,bytes32,uint32)', anchorArgs(n), privateKey)),
    };

    const sendB2 = (n) => send(addr.b2, 'publishBatch(bytes32[])', [`[${Array.from({ length: n }, hex32).join(',')}]`], privateKey);
    const oursGas = meanBatchGas(variants.ours);
    const oursLiteGas = meanBatchGas(variants.ours_lite);
    const b1Gas = variants.B1.gasPerPost.mean;
    const crossovers = {
      ours_vs_B1: { n: Math.floor(oursGas / b1Gas) + 1, rule: 'smallest N with ours per batch / N < B1 per post', oursGas, b1Gas },
      ours_lite_vs_B1: { n: Math.floor(oursLiteGas / b1Gas) + 1, rule: 'smallest N with ours-lite per batch / N < B1 per post', oursLiteGas, b1Gas },
      ours_vs_B2: { ...crossoverAgainstGrowing(oursGas, sendB2), rule: 'smallest N with ours per batch < B2 per batch (measured probes)' },
      ours_lite_vs_B2: { ...crossoverAgainstGrowing(oursLiteGas, sendB2), rule: 'smallest N with ours-lite per batch < B2 per batch (measured probes)' },
      storageSlotPrice: { gas: oursGas - oursLiteGas, rule: 'ours per batch minus ours-lite per batch' },
    };

    const date = new Date().toISOString().slice(0, 10);
    const result = {
      schema: 'onchain-posts.bench.gas/1',
      date,
      environment: {
        anvil: toolVersion('anvil'),
        forge: toolVersion('forge'),
        cast: toolVersion('cast'),
        node: process.version,
        hardfork: HARDFORK,
        solc: '0.8.30',
        compileEvmVersion: 'cancun',
      },
      method: [
        HARDFORK === 'prague'
          ? 'Local anvil node with Ethereum mainnet rules (Prague, including the EIP-7623 calldata floor); gasUsed read from real receipts.'
          : `Local anvil node with ${HARDFORK} rules (no EIP-7623 calldata floor), proxy for Arbitrum execution gas; gasUsed read from real receipts.`,
        'Excludes the L1 data fee charged by L2s on top of execution gas.',
        `B0 and B1 send one transaction per post; ${PER_POST_SAMPLES} sampled posts give the per-post cost for every N.`,
        'Roots, manifest IDs and post hashes are deterministic pseudo-random 32-byte values (sha256 of a counter), so reruns reproduce the same numbers; gas does not depend on whether a root is a real Merkle root.',
        `B0 username "${USERNAME}"; captions of ${SHORT_CAPTION_BYTES} and ${LONG_CAPTION_BYTES} ASCII bytes.`,
      ],
      variants,
      crossovers,
    };

    mkdirSync(resultsDir, { recursive: true });
    const outFile = path.join(resultsDir, `${date}-gas-local-${HARDFORK}.json`);
    writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Gas per post (${HARDFORK} rules), written to ${path.relative(repoRoot, outFile)}\n`);
    console.log(markdownTable(variants));
    console.log(`\nCrossovers: ${Object.entries(crossovers).map(([k, v]) => `${k}=${v.n ?? v.gas}`).join(', ')}`);
  } finally {
    anvil.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
