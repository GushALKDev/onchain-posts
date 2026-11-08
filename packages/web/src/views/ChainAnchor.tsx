import { POST_ANCHOR_ADDRESS, bytes32ToArweaveId, isTrustedKey, leafHash, verifyInclusion, type LeafValue } from '@onchain-posts/core';
import { useEffect, useState } from 'react';
import { concat, decodeAbiParameters, formatEther, formatGwei, keccak256, type Address, type Hex } from 'viem';
import { ChainPill, Check, Hash, STAGE_HELP } from '../components.tsx';
import { chainInfo } from '../config.ts';
import { dateTime, duration } from '../format.ts';
import { bundledKeys } from '../trust.ts';
import type { ChainDetail, PostDetail } from '../types.ts';

const LEAF_TYPES = [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }] as const;

/** OpenZeppelin StandardMerkleTree node: keccak256 of the two children in sorted order. */
const hashPair = (a: Hex, b: Hex): Hex => keccak256(a.toLowerCase() < b.toLowerCase() ? concat([a, b]) : concat([b, a]));

/** One chain: deadline, batch transaction, relayer, live fee from the receipt and the Merkle path from the leaf to the anchored root. */
export function ChainAnchor({ post, chain, now }: { post: PostDetail; chain: ChainDetail; now: number }) {
  const info = chainInfo(chain.chainId);
  const b = chain.batch;
  const explorer = info?.explorer;
  const anchored = b?.anchoredAt ?? null;
  const deadline =
    anchored !== null
      ? anchored <= chain.anchorBy
        ? `met: anchored ${duration(chain.anchorBy - anchored)} before the deadline`
        : `LATE: anchored ${duration(anchored - chain.anchorBy)} after the deadline`
      : chain.anchorBy > now
        ? `${duration(chain.anchorBy - now)} left`
        : 'passed without an anchor';
  const relayerTrusted = b?.sender && anchored !== null ? isTrustedKey(bundledKeys, { role: 'relayer', address: b.sender as Address, chainId: chain.chainId, at: anchored }) : null;

  return (
    <div className="card chain-card" style={{ ['--chain' as string]: info?.color ?? '#64748b' }}>
      <div className="chain-card-head">
        <ChainPill chainId={chain.chainId} stage={chain.stage} />
        <span className="muted small">{STAGE_HELP[chain.stage]}</span>
      </div>
      <div className="kv">
        <span>Receipt deadline</span>
        <span>
          {dateTime(chain.anchorBy)} <span className={`chip ${deadline.startsWith('LATE') || deadline.startsWith('passed') ? 'fail' : anchored !== null ? 'ok' : 'neutral'}`}>{deadline}</span>
        </span>
        {!b && (
          <>
            <span>Batch</span>
            <span className="muted">waiting for the next batch (closes when it is full or after Tmax)</span>
          </>
        )}
        {b && (
          <>
            <span>Batch</span>
            <span>
              #{b.id}
              {b.postCount !== null && (b.postCount === 1 ? ', the only post in this transaction' : `, ${b.postCount} posts share this transaction`)}
              {b.batchedAt && <span className="muted">, closed {dateTime(b.batchedAt)}</span>}
            </span>
            <span>Contract</span>
            <Hash value={POST_ANCHOR_ADDRESS} href={explorer && `${explorer}/address/${POST_ANCHOR_ADDRESS}`} label="PostAnchor" />
            {b.txHash && (
              <>
                <span>Transaction</span>
                <Hash value={b.txHash} href={explorer && `${explorer}/tx/${b.txHash}`} />
              </>
            )}
            {b.blockNumber !== null && (
              <>
                <span>Block</span>
                <span>
                  {explorer ? (
                    <a href={`${explorer}/block/${b.blockNumber}`} target="_blank" rel="noreferrer">
                      {b.blockNumber.toLocaleString('en-US')}
                    </a>
                  ) : (
                    b.blockNumber.toLocaleString('en-US')
                  )}
                  {anchored !== null && <span className="muted">, block time {dateTime(anchored)}</span>}
                </span>
              </>
            )}
            {b.sender && (
              <>
                <span>Relayer (sender)</span>
                <span>
                  <Hash value={b.sender} href={explorer && `${explorer}/address/${b.sender}`} />{' '}
                  {relayerTrusted !== null && <span className={`chip ${relayerTrusted ? 'ok' : 'fail'}`}>{relayerTrusted ? 'listed in trusted-keys.json for this chain' : 'NOT a trusted relayer'}</span>}
                </span>
                <span>Nonce</span>
                <span>
                  {b.nonce}
                  {b.replacements > 0 && <span className="muted">, replaced {b.replacements} time(s) with a higher fee</span>}
                </span>
              </>
            )}
            {b.root && (
              <>
                <span>Merkle root</span>
                <Hash value={b.root} />
              </>
            )}
            {b.settledAt && (
              <>
                <span>Settled</span>
                <span>{dateTime(b.settledAt)}</span>
              </>
            )}
          </>
        )}
      </div>
      {b?.txHash && info && <TxCost rpcUrl={info.rpcUrl} txHash={b.txHash} postCount={b.postCount} layer={info.layer} />}
      {chain.proof && b?.root && <MerklePath post={post} root={b.root as Hex} proof={chain.proof} />}
    </div>
  );
}

/** Picks the unit that keeps testnet-sized amounts readable (testnet fees can be a few wei). */
function eth(wei: bigint): string {
  if (wei < 1_000_000n) return `${wei.toLocaleString('en-US')} wei`;
  if (wei < 10n ** 14n) return `${Number(formatGwei(wei)).toLocaleString('en-US', { maximumSignificantDigits: 3 })} gwei`;
  return `${Number(formatEther(wei)).toLocaleString('en-US', { maximumSignificantDigits: 3 })} ETH`;
}

type RawReceipt = { gasUsed: Hex; effectiveGasPrice: Hex; l1Fee?: Hex; gasUsedForL1?: Hex; status: Hex };

async function rawReceipt(rpcUrl: string, txHash: string): Promise<RawReceipt | null> {
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }) });
  return ((await res.json()) as { result: RawReceipt | null }).result;
}

/** Fee actually paid, read from the transaction receipt on the public RPC. Testnet prices: not the mainnet cost model. */
function TxCost({ rpcUrl, txHash, postCount, layer }: { rpcUrl: string; txHash: string; postCount: number | null; layer: 'L1' | 'L2' }) {
  const [receipt, setReceipt] = useState<RawReceipt | null | undefined>(undefined);
  useEffect(() => {
    rawReceipt(rpcUrl, txHash).then(setReceipt, () => setReceipt(null));
  }, [rpcUrl, txHash]);
  if (!receipt) return null;
  const gas = BigInt(receipt.gasUsed);
  const price = BigInt(receipt.effectiveGasPrice);
  const l1Fee = receipt.l1Fee ? BigInt(receipt.l1Fee) : 0n;
  const total = gas * price + l1Fee;
  return (
    <div className="cost">
      <div>
        <span className="muted small">Gas used</span>
        <strong>{gas.toLocaleString('en-US')}</strong>
        {receipt.gasUsedForL1 && BigInt(receipt.gasUsedForL1) > 0n && <span className="muted small">{BigInt(receipt.gasUsedForL1).toLocaleString('en-US')} of it for L1 data</span>}
      </div>
      <div>
        <span className="muted small">Gas price</span>
        <strong>{eth(price)}</strong>
      </div>
      {layer === 'L2' && receipt.l1Fee && (
        <div>
          <span className="muted small">L1 data fee</span>
          <strong>{eth(l1Fee)}</strong>
        </div>
      )}
      <div>
        <span className="muted small">Fee paid by the platform</span>
        <strong>{eth(total)}</strong>
        {postCount && postCount > 1 && <span className="muted small">{eth(total / BigInt(postCount))} per post</span>}
      </div>
      <p className="muted small cost-note">Live from the transaction receipt. Testnet gas prices; the mainnet cost model is on the Efficiency page.</p>
    </div>
  );
}

/** Recomputes the path from this post's leaf to the anchored root, one sorted-pair hash per level. */
function MerklePath({ post, root, proof }: { post: PostDetail; root: Hex; proof: { leafData: string; siblings: string[] } }) {
  const leaf = decodeAbiParameters(LEAF_TYPES, proof.leafData as Hex) as unknown as LeafValue;
  const [lPostHash, lArweave, lSigCommit] = leaf;
  const arweaveId = bytes32ToArweaveId(lArweave);
  const siblings = proof.siblings as Hex[];
  const nodes: Hex[] = [leafHash(leaf)];
  for (const s of siblings) nodes.push(hashPair(nodes[nodes.length - 1]!, s));
  const computed = nodes[nodes.length - 1]!;
  const included = verifyInclusion(root, leaf, siblings);
  const fields = [
    { name: 'postHash', value: lPostHash, ok: lPostHash.toLowerCase() === post.postHash.toLowerCase(), note: 'content identity (EIP-712 hashStruct)' },
    { name: 'postArweaveId', value: arweaveId, ok: arweaveId === post.postArweaveId, note: 'pins the canonical copy on Arweave' },
    { name: 'sigCommit', value: lSigCommit, ok: lSigCommit.toLowerCase() === post.sigCommit.toLowerCase(), note: 'keccak256 of the author signature; the signature stays private' },
  ];

  return (
    <details className="merkle" open>
      <summary>
        Merkle proof: {siblings.length === 0 ? 'single-leaf tree, the leaf hash is the root' : `${siblings.length} sibling${siblings.length === 1 ? '' : 's'}`}, {included ? 'leaf is in the anchored tree' : 'proof does NOT match the root'}
      </summary>
      <p className="muted small">The leaf is abi.encode(postHash, postArweaveId, sigCommit), double-hashed as in OpenZeppelin StandardMerkleTree. PostAnchor.verifyPost runs this same computation on-chain.</p>
      <div className="leaf">
        {fields.map((f) => (
          <div key={f.name} className="leaf-field">
            <span className={`chip ${f.ok ? 'ok' : 'fail'}`}>{f.ok ? 'matches' : 'mismatch'}</span>
            <code>{f.name}</code>
            <code className="small break">{f.value}</code>
            <span className="muted small">{f.note}</span>
          </div>
        ))}
      </div>
      <ol className="path">
        <li>
          <span className="path-label">leaf hash</span>
          <code className="small break">{nodes[0]}</code>
        </li>
        {siblings.map((s, i) => (
          <li key={s + i}>
            <span className="path-label">+ sibling {i + 1}</span>
            <code className="small break muted">{s}</code>
            <span className="path-label">= node {i + 1}</span>
            <code className="small break">{nodes[i + 1]}</code>
          </li>
        ))}
      </ol>
      <Check state={included ? 'ok' : 'fail'} title={included ? 'Computed root equals the anchored root' : 'Computed root differs from the anchored root'}>
        <span className="mono small break">computed {computed}</span>
        <br />
        <span className="mono small break">anchored {root}</span>
      </Check>
    </details>
  );
}
