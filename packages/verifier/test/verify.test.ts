import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPublishedPost, type VerifierConfig } from '../src/index.ts';
import { MemoryArweave, startChain, trustedKeysFor, type TestChain } from './harness.ts';
import { anchorDecoy, publish, receiptKey, user } from './scenario.ts';

const BASE = 84532;
const ARBITRUM = 421614;
const ETHEREUM = 11155111; // listed in receipts but without a node: its verdict never needs one

let base: TestChain;
let arbitrum: TestChain;
let arweave: MemoryArweave;
let config: VerifierConfig;

const chainById = (id: number) => (id === BASE ? base : arbitrum);
const verdictOf = (report: Awaited<ReturnType<typeof verifyPublishedPost>>, chainId: number) => report.chains.find((c) => c.chainId === chainId);

beforeAll(async () => {
  [base, arbitrum] = await Promise.all([startChain(BASE), startChain(ARBITRUM)]);
  arweave = new MemoryArweave();
  config = {
    sources: { arweave, chains: { [BASE]: base.source, [ARBITRUM]: arbitrum.source } },
    trustedKeys: trustedKeysFor([base, arbitrum], receiptKey),
    scanMarginSeconds: 30,
  };
});

afterAll(() => {
  base?.stop();
  arbitrum?.stop();
});

describe('verification from hints', () => {
  it('verifies a post anchored on two chains, with the third chain pending inside its deadline', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE, ARBITRUM, ETHEREUM], receiptChainIds: [BASE, ARBITRUM, ETHEREUM], anchors: [{ chain: base }, { chain: arbitrum }] });
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt + 10 });

    expect(report).toMatchObject({ ok: true, status: 'verified' });
    expect(report.content).toMatchObject({ valid: true, postArweaveId: p.postArweaveId, imageArweaveId: p.imageArweaveId, username: 'ana' });
    expect(report.receipt).toMatchObject({ present: true, valid: true, signer: receiptKey.address });
    expect(verdictOf(report, BASE)).toMatchObject({ verdict: 'anchored', late: false, anchor: { source: 'hints', sender: base.accounts.relayer.address } });
    expect(verdictOf(report, ARBITRUM)).toMatchObject({ verdict: 'anchored', late: false });
    expect(verdictOf(report, ETHEREUM)).toMatchObject({ verdict: 'pending', anchorBy: p.anchorBy });
  });

  it('ignores hints that describe another post', async () => {
    const a = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base }] });
    const report = await verifyPublishedPost(keccak256(toBytes('another post')), { hints: a.publicBundle }, config);
    expect(report.ok).toBe(false);
    expect(report.notes).toContain('hints ignored: they describe another postHash');
  });

  it('rejects a tampered proof and a leaf that belongs to another post', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base }] });
    const anchor = p.publicBundle.anchors[0]!;
    const badProof = { ...p.publicBundle, anchors: [{ ...anchor, proof: [keccak256(toBytes('x')), ...anchor.proof.slice(1)] }] };
    const r1 = await verifyPublishedPost(p.postHash, { hints: badProof }, { ...config, now: () => p.acceptedAt });
    expect(verdictOf(r1, BASE)?.notes).toContain('hint rejected: PostAnchor.verifyPost rejected the proof');
    expect(r1.ok).toBe(false);

    const other = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base }] });
    const foreignLeaf = { ...p.publicBundle, anchors: [other.publicBundle.anchors[0]!] };
    const r2 = await verifyPublishedPost(p.postHash, { hints: foreignLeaf }, { ...config, now: () => p.acceptedAt });
    expect(verdictOf(r2, BASE)?.notes).toContain('hint rejected: leaf belongs to another post');
  });
});

describe('pending posts', () => {
  it('reports an accepted post that is not anchored yet, inside its deadline, as pending', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [] });
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt + 5 });
    expect(report).toMatchObject({ ok: false, status: 'pending' });
    expect(verdictOf(report, BASE)).toMatchObject({ verdict: 'pending' });
  });
});

describe('trust root', () => {
  it('rejects anchors from a sender that is not a trusted relayer', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base, by: 'outsider' }] });
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt });
    expect(verdictOf(report, BASE)).toMatchObject({ verdict: 'pending' });
    expect(verdictOf(report, BASE)?.notes[0]).toMatch(/is not a trusted relayer for chain 84532 at the anchor time/);
    expect(report.ok).toBe(false);
  });

  it('rejects anchors made after the relayer key was revoked', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base, by: 'revoked' }] });
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt });
    expect(verdictOf(report, BASE)?.notes[0]).toMatch(/not a trusted relayer/);
    expect(report.ok).toBe(false);
  });

  it('ignores the deadlines of a receipt signed by an untrusted key', async () => {
    const forger = privateKeyToAccount(keccak256(toBytes('not a trusted receipt key')));
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE, ARBITRUM], receiptChainIds: [BASE, ARBITRUM], anchors: [{ chain: base }], receiptSigner: forger });
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.anchorBy + 1000 });
    expect(report.receipt).toMatchObject({ present: true, valid: false, signer: forger.address });
    expect(report.receipt.errors).toContain('receipt signer is not a trusted receipt key at acceptedAt');
    expect(verdictOf(report, ARBITRUM)).toBeUndefined(); // no trusted deadline, so no pending or omitted claim
    expect(report.ok).toBe(false);
  });
});

describe('content', () => {
  it('detects a post JSON altered on the gateway', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base }] });
    const original = JSON.parse(new TextDecoder().decode(await arweave.get(p.postArweaveId)));
    arweave.replace(p.postArweaveId, toBytes(JSON.stringify({ ...original, caption: 'edited after publication' })));
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt });
    expect(report.content.valid).toBe(false);
    expect(report.content.errors).toContain('post JSON does not hash to the postHash');
    expect(report.ok).toBe(false);
  });

  it('reports content the gateway does not serve as not available, not as invalid', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base }] });
    arweave.delete(p.postArweaveId);
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt });
    expect(report.content).toMatchObject({ valid: false, available: false });
    expect(report.content.errors[0]).toMatch(/not available from the gateway/);
    expect(verdictOf(report, BASE)).toMatchObject({ verdict: 'anchored' }); // the anchor is still verified
    expect(report).toMatchObject({ ok: false, status: 'pending' });
  });

  it('detects image bytes that do not match the signed image hash', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base }] });
    arweave.replace(p.imageArweaveId, toBytes('different image'));
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt });
    expect(report.content.errors).toContain('image bytes do not match image.hash');
    expect(report.ok).toBe(false);
  });
});

describe('deadlines, scans and omission', () => {
  it('discovers anchors without hints by scanning the trusted relayers', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE, ARBITRUM], receiptChainIds: [BASE, ARBITRUM], anchors: [{ chain: base }, { chain: arbitrum }] });
    const report = await verifyPublishedPost(p.postHash, { scan: true, since: p.acceptedAt - 5 }, { ...config, now: () => p.acceptedAt + 10 });
    expect(report.ok).toBe(true);
    expect(report.content.postArweaveId).toBe(p.postArweaveId); // taken from the leaf, not from any hint
    expect(verdictOf(report, BASE)).toMatchObject({ verdict: 'anchored', anchor: { source: 'scan' } });
    expect(verdictOf(report, ARBITRUM)).toMatchObject({ verdict: 'anchored', anchor: { source: 'scan' } });
  });

  it('flags an anchor made after anchorBy as late', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base, delaySeconds: 120 }], deadlineSeconds: 60 });
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, { ...config, now: () => p.acceptedAt + 300 });
    expect(verdictOf(report, BASE)).toMatchObject({ verdict: 'anchored', late: true });
  });

  it('reports "omitted" only after a complete bounded scan, and "deadline passed, not scanned" before', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE, ARBITRUM], receiptChainIds: [BASE, ARBITRUM], anchors: [{ chain: base }] });
    await anchorDecoy(arweave, arbitrum, { uploadManifest: true }); // other users' batch inside the window
    await arbitrum.increaseTime(200); // close the window: anchorBy (60 s) + margin (30 s)
    const later = { ...config, now: () => p.acceptedAt + 200 };

    const withoutScan = await verifyPublishedPost(p.postHash, { hints: p.publicBundle }, later);
    expect(verdictOf(withoutScan, ARBITRUM)).toMatchObject({ verdict: 'deadline-passed-not-scanned' });
    expect(withoutScan.ok).toBe(true); // nothing is claimed omitted without the scan

    const withScan = await verifyPublishedPost(p.postHash, { hints: p.publicBundle, scan: true }, later);
    expect(verdictOf(withScan, ARBITRUM)).toMatchObject({ verdict: 'omitted', anchorBy: p.anchorBy });
    expect(verdictOf(withScan, BASE)).toMatchObject({ verdict: 'anchored' });
    expect(withScan).toMatchObject({ ok: false, status: 'failed' });
  });

  it('never reports "omitted" when a manifest in the window cannot be fetched', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [ARBITRUM], receiptChainIds: [ARBITRUM], anchors: [] });
    await anchorDecoy(arweave, arbitrum, { uploadManifest: false });
    await arbitrum.increaseTime(200);
    const report = await verifyPublishedPost(p.postHash, { hints: p.publicBundle, scan: true }, { ...config, now: () => p.acceptedAt + 200 });
    expect(verdictOf(report, ARBITRUM)).toMatchObject({ verdict: 'deadline-passed-not-scanned' });
    expect(verdictOf(report, ARBITRUM)?.notes.some((n) => n.startsWith('scan: block'))).toBe(true);
    expect(verdictOf(report, ARBITRUM)?.notes).toContain('scan incomplete');
  });
});

describe('authorship', () => {
  it('proves authorship from the private bundle without any platform input', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE, ARBITRUM], receiptChainIds: [BASE, ARBITRUM], anchors: [{ chain: base }, { chain: arbitrum }] });
    const report = await verifyPublishedPost(p.postHash, { hints: p.privateBundle }, { ...config, now: () => p.acceptedAt });
    expect(report.authorship).toEqual({ proven: true, signer: user.address, errors: [] });
    expect(report.ok).toBe(true);
  });

  it('shows that the platform anchored on a chain the author did not sign', async () => {
    const p = await publish({ arweave, allChains: [base, arbitrum], signedChainIds: [BASE], receiptChainIds: [BASE], anchors: [{ chain: base }, { chain: chainById(ARBITRUM) }] });
    const report = await verifyPublishedPost(p.postHash, { hints: p.privateBundle }, { ...config, now: () => p.acceptedAt });
    expect(report.authorship?.proven).toBe(false);
    expect(report.authorship?.errors).toContain('anchored on chain 421614, which the author did not sign');
  });
});
