import {
  POST_ANCHOR_ADDRESS,
  PostJsonSchema,
  ProofBundleSchema,
  bytes32ToArweaveId,
  inspectWebp,
  isTrustedKey,
  postFromJson,
  postHash as hashPost,
  receiptFromJson,
  recoverIntentSigner,
  recoverReceiptSigner,
  relayersForChain,
  sigCommit,
  type Post,
  type ProofBundle,
  type SignedReceipt,
  type TrustedKey,
} from '@phi/core';
import { decodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { scanForPost, type ScanOutcome } from './scan.ts';
import type { Sources } from './sources.ts';

export type Verdict = 'anchored' | 'pending' | 'deadline-passed-not-scanned' | 'omitted' | 'not-found';

export type AnchorEvidence = {
  sender: Address;
  root: Hex;
  anchoredAt: number;
  source: 'hints' | 'scan';
  postArweaveId: Hex;
  sigCommit: Hex;
};

export type ChainResult = { chainId: number; verdict: Verdict; anchorBy?: number; late?: boolean; anchor?: AnchorEvidence; notes: string[] };

export type VerificationStatus = 'verified' | 'pending' | 'failed';

export type VerificationReport = {
  postHash: Hex;
  checkedAt: number;
  /**
   * verified: content valid, anchored on at least one chain, nothing omitted, receipt valid if given, authorship proven if checked.
   * pending: nothing failed, but the content is not served by any gateway yet, or no chain is anchored yet inside its deadline.
   * failed: any check failed.
   */
  status: VerificationStatus;
  /** status === 'verified'. */
  ok: boolean;
  /** `available` is false when the gateway did not serve the post JSON or the image: that is not evidence of invalid content. */
  content: { valid: boolean; available: boolean; postArweaveId?: string; imageArweaveId?: string | null; username?: string; createdAt?: number; errors: string[]; warnings: string[] };
  receipt: { present: boolean; valid: boolean; signer?: Address; acceptedAt?: number; errors: string[] };
  chains: ChainResult[];
  authorship?: { proven: boolean; signer?: Address; errors: string[] };
  notes: string[];
};

export type VerifyOptions = {
  /** Untrusted proof bundle (from GET /proof/:postHash or the user's private copy). Everything in it is re-checked. */
  hints?: unknown;
  /** Scan BatchAnchored events of the trusted relayers: discovery without hints, and the bounded scan behind "omitted". */
  scan?: boolean;
  /** Start of the discovery window (unix seconds) when there is no valid receipt to bound it. */
  since?: number;
};

export type VerifierConfig = {
  sources: Sources;
  trustedKeys: readonly TrustedKey[];
  contract?: Address;
  /** Current time in unix seconds; defaults to the system clock. */
  now?: () => number;
  /** Extra time after anchorBy covered by the bounded scan (design parameter). */
  scanMarginSeconds?: number;
};

export const DEFAULT_SCAN_MARGIN_SECONDS = 120;

type LeafValues = { postHash: Hex; postArweaveId: Hex; sigCommit: Hex };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function decodeLeaf(leafData: Hex): LeafValues {
  const [postHash, postArweaveId, commit] = decodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], leafData);
  return { postHash, postArweaveId, sigCommit: commit };
}

/**
 * Verifies a post using only public sources and the trusted keys. Hints only save discovery time: an anchor is
 * accepted only after PostAnchor confirms it for a sender that config/trusted-keys.json lists for that chain at the
 * anchor time, and "omitted" is reported only after a complete bounded scan (ADR-015).
 */
export async function verifyPublishedPost(postHash: Hex, options: VerifyOptions, config: VerifierConfig): Promise<VerificationReport> {
  const contract = config.contract ?? POST_ANCHOR_ADDRESS;
  const now = config.now?.() ?? Math.floor(Date.now() / 1000);
  const margin = config.scanMarginSeconds ?? DEFAULT_SCAN_MARGIN_SECONDS;
  const report: VerificationReport = {
    postHash,
    checkedAt: now,
    status: 'failed',
    ok: false,
    content: { valid: false, available: true, errors: [], warnings: [] },
    receipt: { present: false, valid: false, errors: [] },
    chains: [],
    notes: [],
  };

  const hints = parseHints(options.hints, postHash, report);
  const receipt = hints?.receipt ? await checkReceipt(hints.receipt, postHash, config.trustedKeys, report) : null;

  // Anchors from hints: re-verified on-chain, never taken on trust.
  const anchors = new Map<number, AnchorEvidence>();
  const chainNotes = new Map<number, string[]>();
  const noteFor = (chainId: number, note: string) => chainNotes.set(chainId, [...(chainNotes.get(chainId) ?? []), note]);
  for (const hint of hints?.anchors ?? []) {
    const result = await checkAnchor(config, contract, postHash, hint.chainId, hint.sender as Address, hint.root as Hex, hint.leafData as Hex, hint.proof as Hex[], 'hints');
    if ('error' in result) noteFor(hint.chainId, `hint rejected: ${result.error}`);
    else anchors.set(hint.chainId, result);
  }

  // Scans: bounded by the receipt when it is valid, otherwise by `since`.
  const scans = new Map<number, ScanOutcome>();
  if (options.scan) {
    const targets = receipt ? receipt.deadlines.map((d) => d.chainId) : Object.keys(config.sources.chains).map(Number);
    for (const chainId of targets) {
      if (anchors.has(chainId)) continue;
      const chain = config.sources.chains[chainId];
      if (!chain) {
        noteFor(chainId, 'no RPC configured for this chain');
        continue;
      }
      const deadline = receipt?.deadlines.find((d) => d.chainId === chainId);
      const fromTime = receipt ? receipt.acceptedAt : options.since;
      const toTime = deadline ? deadline.anchorBy + margin : now;
      if (fromTime === undefined) {
        noteFor(chainId, 'not scanned: a valid receipt or a start time (since) is needed to bound the scan');
        continue;
      }
      const outcome = await scanForPost({
        chain,
        chainId,
        arweave: config.sources.arweave,
        contract,
        senders: relayersForChain(config.trustedKeys, chainId),
        postHash,
        fromTime: BigInt(fromTime),
        toTime: BigInt(toTime),
      });
      scans.set(chainId, outcome);
      for (const problem of outcome.problems) noteFor(chainId, `scan: ${problem}`);
      if (outcome.hit) {
        const { event, leafData, proof } = outcome.hit;
        const result = await checkAnchor(config, contract, postHash, chainId, event.sender, event.root, leafData, proof, 'scan');
        if ('error' in result) noteFor(chainId, `scan hit rejected: ${result.error}`);
        else anchors.set(chainId, result);
      }
    }
  }

  // The leaf pins the canonical post JSON and the signature commitment; every chain must agree.
  const evidence = [...anchors.values()];
  const leafIds = new Set(evidence.map((a) => a.postArweaveId.toLowerCase()));
  const commits = new Set(evidence.map((a) => a.sigCommit.toLowerCase()));
  if (leafIds.size > 1) report.content.errors.push('anchors on different chains point to different post JSON copies');
  if (commits.size > 1) report.notes.push('anchors on different chains carry different sigCommit values');
  const pinnedId = evidence[0] ? bytes32ToArweaveId(evidence[0].postArweaveId) : undefined;
  if (pinnedId && hints && hints.postArweaveId !== pinnedId) report.notes.push('the hinted postArweaveId differs from the one pinned in the leaf; the leaf wins');
  const post = await checkContent(config.sources, postHash, pinnedId ?? hints?.postArweaveId, hints, report);

  report.chains = verdicts(anchors, scans, chainNotes, receipt, now);
  if (hints?.signature && hints.intent) report.authorship = await checkAuthorship(hints, post, evidence, report.chains);

  const contentWaiting = !report.content.available;
  const failed =
    (report.content.available && !report.content.valid) ||
    (report.receipt.present && !report.receipt.valid) ||
    report.chains.some((c) => c.verdict === 'omitted') ||
    (report.authorship !== undefined && !report.authorship.proven && !contentWaiting);
  const anchored = evidence.length > 0;
  const waiting = contentWaiting || (!anchored && report.chains.some((c) => c.verdict === 'pending'));
  report.status = failed ? 'failed' : anchored && report.content.valid ? 'verified' : waiting ? 'pending' : 'failed';
  report.ok = report.status === 'verified';
  return report;
}

function parseHints(raw: unknown, postHash: Hex, report: VerificationReport): ProofBundle | null {
  if (raw === undefined) return null;
  const parsed = ProofBundleSchema.safeParse(raw);
  if (!parsed.success) {
    report.notes.push(`hints ignored: not a valid phi.proof/1 bundle (${parsed.error.issues[0]?.message ?? 'schema error'})`);
    return null;
  }
  if (!same(parsed.data.postHash, postHash)) {
    report.notes.push('hints ignored: they describe another postHash');
    return null;
  }
  return parsed.data;
}

async function checkReceipt(json: SignedReceipt, postHash: Hex, keys: readonly TrustedKey[], report: VerificationReport): Promise<SignedReceipt | null> {
  report.receipt.present = true;
  report.receipt.acceptedAt = json.acceptedAt;
  try {
    report.receipt.signer = await recoverReceiptSigner(receiptFromJson(json), json.signature as Hex);
  } catch {
    report.receipt.errors.push('receipt signature is malformed');
    return null;
  }
  if (!same(json.postHash, postHash)) report.receipt.errors.push('receipt is for another postHash');
  // Consistency check only: acceptedAt is declared by the signer, so a compromised key could backdate (ADR-015).
  if (!isTrustedKey(keys, { role: 'receipt', address: report.receipt.signer, at: json.acceptedAt })) {
    report.receipt.errors.push('receipt signer is not a trusted receipt key at acceptedAt');
  }
  report.receipt.valid = report.receipt.errors.length === 0;
  if (!report.receipt.valid) report.notes.push('per-chain deadlines ignored: the receipt is not valid');
  return report.receipt.valid ? json : null;
}

async function checkAnchor(
  config: VerifierConfig,
  contract: Address,
  postHash: Hex,
  chainId: number,
  sender: Address,
  root: Hex,
  leafData: Hex,
  proof: Hex[],
  source: AnchorEvidence['source'],
): Promise<AnchorEvidence | { error: string }> {
  const chain = config.sources.chains[chainId];
  if (!chain) return { error: 'no RPC configured for this chain' };

  let leaf: LeafValues;
  try {
    leaf = decodeLeaf(leafData);
  } catch {
    return { error: 'leafData is not abi.encode(bytes32, bytes32, bytes32)' };
  }
  if (!same(leaf.postHash, postHash)) return { error: 'leaf belongs to another post' };

  const anchoredAt = Number(await chain.anchoredAt(contract, sender, root));
  if (anchoredAt === 0) return { error: `root ${root} is not anchored by ${sender}` };
  if (!isTrustedKey(config.trustedKeys, { role: 'relayer', address: sender, chainId, at: anchoredAt })) {
    return { error: `${sender} is not a trusted relayer for chain ${chainId} at the anchor time` };
  }
  if (!(await chain.verifyPost(contract, sender, root, leafData, proof))) return { error: 'PostAnchor.verifyPost rejected the proof' };

  return { sender, root, anchoredAt, source, postArweaveId: leaf.postArweaveId, sigCommit: leaf.sigCommit };
}

async function checkContent(sources: Sources, postHash: Hex, postArweaveId: string | undefined, hints: ProofBundle | null, report: VerificationReport): Promise<Post | null> {
  const content = report.content;
  if (!postArweaveId) {
    content.errors.push('no post Arweave ID: give hints or let a scan find an anchor');
    return null;
  }
  content.postArweaveId = postArweaveId;

  let bytes: Uint8Array;
  try {
    bytes = await sources.arweave.get(postArweaveId);
  } catch (error) {
    // Turbo accepts an upload before gateways serve it; a missing item is "not available yet", not invalid content.
    content.available = false;
    content.errors.push(`post JSON is not available from the gateway (retry later): ${(error as Error).message}`);
    return null;
  }
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    content.errors.push('post JSON is not valid JSON');
    return null;
  }
  const parsed = PostJsonSchema.safeParse(json);
  if (!parsed.success) {
    content.errors.push('post JSON does not match phi.post/1');
    return null;
  }
  const post = postFromJson(parsed.data);
  if (!same(hashPost(post), postHash)) content.errors.push('post JSON does not hash to the postHash');
  if (!same(parsed.data.postHash, postHash)) content.errors.push('post JSON declares another postHash');
  content.username = parsed.data.username;
  content.createdAt = parsed.data.createdAt;
  content.imageArweaveId = parsed.data.image?.arweaveId ?? null;

  if (parsed.data.image) {
    const image = parsed.data.image;
    if (hints && hints.imageArweaveId !== image.arweaveId) report.notes.push('the hinted imageArweaveId differs from the post JSON; the post JSON wins');
    let imageBytes: Uint8Array | null = null;
    try {
      imageBytes = await sources.arweave.get(image.arweaveId);
    } catch (error) {
      content.available = false;
      content.errors.push(`image is not available from the gateway (retry later): ${(error as Error).message}`);
    }
    if (imageBytes) {
      if (!same(keccak256(imageBytes), image.hash)) content.errors.push('image bytes do not match image.hash');
      if (imageBytes.length !== image.bytes) content.warnings.push(`image size is ${imageBytes.length} bytes, the post JSON says ${image.bytes}`);
      try {
        const info = inspectWebp(imageBytes);
        if (info.disallowed.length > 0) content.warnings.push(`image carries chunks outside the allowlist: ${info.disallowed.join(', ')}`);
      } catch (error) {
        content.warnings.push(`image is not a well-formed WebP: ${(error as Error).message}`);
      }
    }
  } else if (hints?.imageArweaveId) {
    report.notes.push('the hints name an image but the post JSON has none');
  }

  content.valid = content.errors.length === 0;
  return content.valid ? post : null;
}

function verdicts(
  anchors: Map<number, AnchorEvidence>,
  scans: Map<number, ScanOutcome>,
  chainNotes: Map<number, string[]>,
  receipt: SignedReceipt | null,
  now: number,
): ChainResult[] {
  const deadlines = receipt?.deadlines ?? [];
  const chainIds = [...new Set([...deadlines.map((d) => d.chainId), ...anchors.keys(), ...scans.keys()])].sort((a, b) => a - b);

  return chainIds.map((chainId): ChainResult => {
    const notes = chainNotes.get(chainId) ?? [];
    const anchor = anchors.get(chainId);
    const deadline = deadlines.find((d) => d.chainId === chainId);
    const scan = scans.get(chainId);

    if (anchor) {
      if (!deadline && receipt) notes.push('anchored on a chain the receipt does not list');
      return { chainId, verdict: 'anchored', anchorBy: deadline?.anchorBy, late: deadline ? anchor.anchoredAt > deadline.anchorBy : undefined, anchor, notes };
    }
    if (!deadline) return { chainId, verdict: 'not-found', notes: [...notes, 'not found in the scanned range'] };
    if (now < deadline.anchorBy) return { chainId, verdict: 'pending', anchorBy: deadline.anchorBy, notes };
    if (scan?.complete && scan.windowClosed) {
      return { chainId, verdict: 'omitted', anchorBy: deadline.anchorBy, notes: [...notes, `bounded scan of ${scan.eventsScanned} trusted batches in blocks ${scan.fromBlock}-${scan.toBlock} did not find the post`] };
    }
    const reason = !scan ? 'scan not run' : !scan.complete ? 'scan incomplete' : 'scan window not closed yet';
    return { chainId, verdict: 'deadline-passed-not-scanned', anchorBy: deadline.anchorBy, notes: [...notes, reason] };
  });
}

async function checkAuthorship(hints: ProofBundle, post: Post | null, evidence: AnchorEvidence[], chains: ChainResult[]): Promise<NonNullable<VerificationReport['authorship']>> {
  const result: NonNullable<VerificationReport['authorship']> = { proven: false, errors: [] };
  if (!post) result.errors.push('the content is not available or not valid, so the signed post cannot be rebuilt');
  if (evidence.length === 0) result.errors.push('no verified anchor carries a sigCommit to compare with');
  if (!post || evidence.length === 0 || !hints.signature || !hints.intent) return result;

  const signature = hints.signature as Hex;
  const intent = { post, chainIds: hints.intent.chainIds.map(BigInt), nonce: hints.intent.nonce as Hex, deadline: BigInt(hints.intent.deadline) };
  try {
    result.signer = await recoverIntentSigner(intent, signature);
  } catch {
    result.errors.push('signature is malformed');
    return result;
  }
  if (!evidence.every((a) => same(a.sigCommit, sigCommit(signature)))) result.errors.push('keccak256(signature) does not match the sigCommit in the anchored leaf');
  for (const chain of chains) {
    if (chain.verdict === 'anchored' && !hints.intent.chainIds.includes(chain.chainId)) result.errors.push(`anchored on chain ${chain.chainId}, which the author did not sign`);
  }
  result.proven = result.errors.length === 0;
  return result;
}
