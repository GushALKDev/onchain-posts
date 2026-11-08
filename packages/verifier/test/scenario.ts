import {
  CONTENT_TYPE_POST,
  POST_ANCHOR_ADDRESS,
  POSTS_DOMAIN,
  POST_TYPES,
  RECEIPTS_DOMAIN,
  RECEIPT_TYPES,
  arweaveIdToBytes32,
  buildBatch,
  imageHash,
  inclusionProof,
  postAnchorAbi,
  postHash as hashPost,
  sigCommit,
  type PostJson,
  type ProofBundle,
  type SignedReceipt,
} from '@phi/core';
import { keccak256, toBytes, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { MemoryArweave, TestChain } from './harness.ts';

export const user = privateKeyToAccount(keccak256(toBytes('phi-test-user')));
export const receiptKey = privateKeyToAccount(keccak256(toBytes('phi-test-receipt-key')));

let counter = 0;
const random32 = (): Hex => keccak256(toBytes(`value ${counter++} ${Math.random()}`));

/** Minimal still WebP (one VP8 frame header), unique per call. */
function webp(): Uint8Array {
  const frame = [0x9d, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x38, 0x04, 0x38, 0x04, counter & 0xff, (counter++ >> 8) & 0xff];
  const riff = [...toBytes('RIFF'), 24, 0, 0, 0, ...toBytes('WEBP'), ...toBytes('VP8 '), 12, 0, 0, 0, ...frame];
  return Uint8Array.from(riff);
}

export type AnchorPlan = { chain: TestChain; by?: 'relayer' | 'outsider' | 'revoked'; delaySeconds?: number };

export type Published = {
  postHash: Hex;
  postArweaveId: string;
  imageArweaveId: string;
  acceptedAt: number;
  anchorBy: number;
  publicBundle: ProofBundle;
  privateBundle: ProofBundle;
};

/**
 * Plays the platform's role end to end: stores image and post JSON, signs the receipt, builds one batch per chain
 * (with two unrelated posts in it) and anchors the root from the chosen sender.
 */
export async function publish(args: {
  arweave: MemoryArweave;
  signedChainIds: number[];
  receiptChainIds: number[];
  anchors: AnchorPlan[];
  allChains: TestChain[];
  deadlineSeconds?: number;
  receiptSigner?: PrivateKeyAccount;
}): Promise<Published> {
  const { arweave } = args;
  const image = webp();
  const imageArweaveId = arweave.put(image);
  const heads = await Promise.all(args.allChains.map((c) => c.head()));
  const acceptedAt = Math.min(...heads) - 1;
  const anchorBy = acceptedAt + (args.deadlineSeconds ?? 60);

  const post = { username: 'ana', contentType: CONTENT_TYPE_POST, caption: `hello ${counter++}`, imageHash: imageHash(image), createdAt: BigInt(acceptedAt) };
  const postHash = hashPost(post);
  const postJson: PostJson = {
    schema: 'phi.post/1',
    type: 'post',
    username: post.username,
    caption: post.caption,
    createdAt: acceptedAt,
    image: { arweaveId: imageArweaveId, hash: post.imageHash, mime: 'image/webp', bytes: image.length, width: 1080, height: 1080 },
    postHash,
  };
  const postArweaveId = arweave.put(toBytes(JSON.stringify(postJson)));

  const intent = { post, chainIds: args.signedChainIds.map(BigInt), nonce: random32(), deadline: BigInt(acceptedAt + 3600) };
  const signature = await user.signTypedData({ domain: POSTS_DOMAIN, types: POST_TYPES, primaryType: 'PublishIntent', message: intent });
  const commit = sigCommit(signature);

  const deadlines = args.receiptChainIds.map((chainId) => ({ chainId, anchorBy }));
  const receiptMessage = { postHash, sigCommit: commit, acceptedAt: BigInt(acceptedAt), deadlines: deadlines.map((d) => ({ chainId: BigInt(d.chainId), anchorBy: BigInt(d.anchorBy) })) };
  const receiptSignature = await (args.receiptSigner ?? receiptKey).signTypedData({ domain: RECEIPTS_DOMAIN, types: RECEIPT_TYPES, primaryType: 'Receipt', message: receiptMessage });
  const receipt: SignedReceipt = { postHash, sigCommit: commit, acceptedAt, deadlines, signature: receiptSignature };

  const anchors: ProofBundle['anchors'] = [];
  for (const plan of args.anchors) {
    const filler = [0, 1].map(() => ({ postHash: random32(), postArweaveId: arweave.put(toBytes(`filler ${counter++}`)), sigCommit: random32() }));
    const { manifest, tree } = buildBatch(plan.chain.chainId, [{ postHash, postArweaveId, sigCommit: commit }, ...filler]);
    const manifestId = arweave.put(toBytes(JSON.stringify(manifest)));
    if (plan.delaySeconds) await plan.chain.increaseTime(plan.delaySeconds);
    const account = plan.chain.accounts[plan.by ?? 'relayer'];
    const txHash = await plan.chain.wallet(account).writeContract({
      account,
      address: POST_ANCHOR_ADDRESS,
      abi: postAnchorAbi,
      functionName: 'anchor',
      args: [manifest.root, arweaveIdToBytes32(manifestId), manifest.leaves.length],
      chain: null,
    });
    await plan.chain.publicClient.waitForTransactionReceipt({ hash: txHash });
    const proof = inclusionProof(tree, postHash)!;
    anchors.push({ chainId: plan.chain.chainId, sender: account.address, root: manifest.root, manifestId, txHash, leafData: proof.leafData, proof: proof.proof });
  }

  const anchored = new Set(anchors.map((a) => a.chainId));
  const publicBundle: ProofBundle = {
    schema: 'phi.proof/1',
    postHash,
    postArweaveId,
    imageArweaveId,
    anchors,
    pending: deadlines.filter((d) => !anchored.has(d.chainId)),
    receipt,
  };
  const privateBundle: ProofBundle = { ...publicBundle, signature, intent: { chainIds: args.signedChainIds, nonce: intent.nonce, deadline: Number(intent.deadline) } };
  return { postHash, postArweaveId, imageArweaveId, acceptedAt, anchorBy, publicBundle, privateBundle };
}

/** Anchors a batch of unrelated posts from the trusted relayer, as other users' traffic. */
export async function anchorDecoy(arweave: MemoryArweave, chain: TestChain, options: { uploadManifest: boolean }) {
  const entries = [0, 1, 2].map(() => ({ postHash: random32(), postArweaveId: arweave.put(toBytes(`decoy ${counter++}`)), sigCommit: random32() }));
  const { manifest } = buildBatch(chain.chainId, entries);
  const bytes = toBytes(JSON.stringify(manifest));
  const manifestId = arweave.put(bytes);
  if (!options.uploadManifest) arweave.delete(manifestId);
  const txHash = await chain.wallet(chain.accounts.relayer).writeContract({
    account: chain.accounts.relayer,
    address: POST_ANCHOR_ADDRESS,
    abi: postAnchorAbi,
    functionName: 'anchor',
    args: [manifest.root, arweaveIdToBytes32(manifestId), manifest.leaves.length],
    chain: null,
  });
  await chain.publicClient.waitForTransactionReceipt({ hash: txHash });
}
