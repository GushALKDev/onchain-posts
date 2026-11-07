import { concat, encodeAbiParameters, keccak256, toBytes, zeroHash, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  POST_ANCHOR_ADDRESS,
  POSTS_DOMAIN,
  POST_TYPES,
  RECEIPTS_DOMAIN,
  RECEIPT_TYPES,
  imageHash,
  postHash,
  publishIntentDigest,
  receiptDigest,
  recoverIntentSigner,
  recoverReceiptSigner,
  sigCommit,
  type Receipt,
} from '../src/index.ts';
import { receiptAccount, sampleIntent, samplePost, userAccount } from './helpers.ts';

const POST_TYPE = 'Post(string username,string contentType,string caption,bytes32 imageHash,uint64 createdAt)';
const str = (s: string) => keccak256(toBytes(s));

// Independent EIP-712 encoding written from the specification, to check viem's output.
function manualPostHash(p: ReturnType<typeof samplePost>): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }],
      [str(POST_TYPE), str(p.username), str(p.contentType), str(p.caption), p.imageHash, p.createdAt],
    ),
  );
}

describe('EIP-712 content and intent', () => {
  it('postHash matches a manual hashStruct(Post)', () => {
    const post = samplePost(1);
    expect(postHash(post)).toBe(manualPostHash(post));
  });

  it('the intent domain has no chainId', () => {
    const post = samplePost(1);
    const intent = sampleIntent(post, 1);
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }],
        [str('EIP712Domain(string name,string version,address verifyingContract)'), str('Phi Posts'), str('1'), POST_ANCHOR_ADDRESS],
      ),
    );
    const intentType = `PublishIntent(Post post,uint256[] chainIds,bytes32 nonce,uint64 deadline)${POST_TYPE}`;
    // EIP-712 arrays: keccak256 of the concatenated 32-byte encodings of the elements.
    const chainIdsHash = keccak256(concat(intent.chainIds.map((c) => encodeAbiParameters([{ type: 'uint256' }], [c]))));
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }],
        [str(intentType), manualPostHash(post), chainIdsHash, intent.nonce, intent.deadline],
      ),
    );
    expect(publishIntentDigest(intent)).toBe(keccak256(concat(['0x1901', domainSeparator, structHash])));
  });

  it('recovers the signer of a PublishIntent and commits to the signature', async () => {
    const intent = sampleIntent(samplePost(2), 2);
    const signature = await userAccount.signTypedData({ domain: POSTS_DOMAIN, types: POST_TYPES, primaryType: 'PublishIntent', message: intent });
    expect(await recoverIntentSigner(intent, signature)).toBe(userAccount.address);
    expect(sigCommit(signature)).toBe(keccak256(signature));
  });

  it('a signature over one chain set does not verify for another', async () => {
    const intent = sampleIntent(samplePost(3), 3);
    const signature = await userAccount.signTypedData({ domain: POSTS_DOMAIN, types: POST_TYPES, primaryType: 'PublishIntent', message: intent });
    const widened = { ...intent, chainIds: [...intent.chainIds, 11155111n] };
    expect(await recoverIntentSigner(widened, signature)).not.toBe(userAccount.address);
  });

  it('imageHash is keccak256 of the bytes, or zero without image', () => {
    expect(imageHash(null)).toBe(zeroHash);
    expect(imageHash(toBytes('abc'))).toBe(keccak256(toBytes('abc')));
  });
});

describe('EIP-712 receipts', () => {
  const receipt: Receipt = {
    postHash: postHash(samplePost(4)),
    sigCommit: keccak256(toBytes('sig')),
    acceptedAt: 1_762_480_000n,
    deadlines: [
      { chainId: 84532n, anchorBy: 1_762_480_120n },
      { chainId: 11155111n, anchorBy: 1_762_480_600n },
    ],
  };

  it('the receipt domain has only name and version', () => {
    const domainSeparator = keccak256(
      encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [str('EIP712Domain(string name,string version)'), str('Phi Receipts'), str('1')]),
    );
    const deadlineType = 'Deadline(uint256 chainId,uint64 anchorBy)';
    const deadlines = keccak256(
      concat(receipt.deadlines.map((d) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint64' }], [str(deadlineType), d.chainId, d.anchorBy])))),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }],
        [str(`Receipt(bytes32 postHash,bytes32 sigCommit,uint64 acceptedAt,Deadline[] deadlines)${deadlineType}`), receipt.postHash, receipt.sigCommit, receipt.acceptedAt, deadlines],
      ),
    );
    expect(receiptDigest(receipt)).toBe(keccak256(concat(['0x1901', domainSeparator, structHash])));
  });

  it('recovers the receipt signer', async () => {
    const signature = await receiptAccount.signTypedData({ domain: RECEIPTS_DOMAIN, types: RECEIPT_TYPES, primaryType: 'Receipt', message: receipt });
    expect(await recoverReceiptSigner(receipt, signature)).toBe(receiptAccount.address);
  });
});
