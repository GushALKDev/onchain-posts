import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerificationReport } from '../src/index.ts';
import { MemoryArweave, serveArweave, startChain, trustedKeysFor, type TestChain } from './harness.ts';
import { publish, receiptKey } from './scenario.ts';

const run = promisify(execFile);
const CLI = new URL('../src/cli.ts', import.meta.url).pathname;

let base: TestChain;
let arweave: MemoryArweave;
let gateway: { url: string; close: () => void };
let dir: string;

beforeAll(async () => {
  base = await startChain(84532);
  arweave = new MemoryArweave();
  gateway = await serveArweave(arweave);
  dir = mkdtempSync(path.join(tmpdir(), 'phi-cli-'));
});

afterAll(() => {
  base?.stop();
  gateway?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('onchain-posts-verify CLI', () => {
  it('verifies a post from a hints file, a trusted-keys file, an RPC and a gateway, and exits 0', async () => {
    const p = await publish({ arweave, allChains: [base], signedChainIds: [84532], receiptChainIds: [84532], anchors: [{ chain: base }] });
    const hints = path.join(dir, 'bundle.json');
    const keys = path.join(dir, 'trusted-keys.json');
    writeFileSync(hints, JSON.stringify(p.publicBundle));
    writeFileSync(keys, JSON.stringify({ schema: 'onchain-posts.trusted-keys/1', description: 'test', keys: trustedKeysFor([base], receiptKey) }));

    const { stdout } = await run('node', [CLI, p.postHash, '--hints', hints, '--trusted-keys', keys, '--rpc', `84532=${base.url}`, '--gateway', gateway.url, '--json']);
    const report: VerificationReport = JSON.parse(stdout);
    expect(report.ok).toBe(true);
    expect(report.chains).toMatchObject([{ chainId: 84532, verdict: 'anchored' }]);
  });

  it('prints a human-readable report and exits 1 when the post cannot be verified', async () => {
    const keys = path.join(dir, 'trusted-keys.json');
    const unknown = `0x${'ab'.repeat(32)}`;
    const failure = await run('node', [CLI, unknown, '--trusted-keys', keys, '--rpc', `84532=${base.url}`, '--gateway', gateway.url]).catch((e) => e);
    expect(failure.code).toBe(1);
    expect(failure.stdout).toContain('Result: NOT VERIFIED');
    expect(failure.stdout).toContain('no post Arweave ID');
  });

  it('prints usage and exits 2 for a malformed postHash', async () => {
    const failure = await run('node', [CLI, 'not-a-hash']).catch((e) => e);
    expect(failure.code).toBe(2);
    expect(failure.stdout).toContain('Usage: onchain-posts-verify');
  });
});
