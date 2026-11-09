import { arweaveIdToBytes32, postAnchorAbi } from '@onchain-posts/core';
import { BaseError, ContractFunctionRevertedError, bytesToHex, getAbiItem, hexToBytes, type Hex } from 'viem';
import type { ChainContext } from '../chains.ts';
import type { Deps } from '../deps.ts';
import { log, redact } from '../log.ts';

/** Replacement policy (design parameters, ADR-008). Replacements must raise fees by at least 10% to be accepted. */
export const ANCHOR_POLICY = { bumpAfterSeconds: 60, feeBumpPercent: 25n, gasLimitMarginPercent: 20n } as const;

type BatchRow = {
  id: string;
  root: Buffer;
  manifest_arweave_id: string;
  post_count: number;
  nonce: string | null;
  tx_history: Hex[];
  gas_limit: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee: string | null;
  submitted_at: string | null;
};

const batchAnchored = getAbiItem({ abi: postAnchorAbi, name: 'BatchAnchored' });

/**
 * One in-flight transaction per chain: monitor it if there is one, otherwise send the next ready batch. Retries never
 * anchor twice: the contract rejects a duplicate (sender, root), the worker checks the chain before sending, and a stuck
 * transaction is replaced with the same nonce so only one version can land (ADR-008). Re-batching a stuck batch with
 * newer posts is not implemented in the PoC; stuck transactions are only fee-bumped.
 */
export async function anchorChain(deps: Deps, ctx: ChainContext): Promise<void> {
  const chainId = ctx.config.chainId;
  const [inflight] = await deps.sql<BatchRow[]>`SELECT * FROM batches WHERE chain_id = ${chainId} AND state = 'SUBMITTED' ORDER BY id LIMIT 1`;
  if (inflight) return monitor(deps, ctx, inflight);
  const [next] = await deps.sql<BatchRow[]>`SELECT * FROM batches WHERE chain_id = ${chainId} AND state = 'READY' ORDER BY id LIMIT 1`;
  if (next) return submit(deps, ctx, next);
}

async function anchoredAt(ctx: ChainContext, root: Hex): Promise<bigint> {
  return ctx.publicClient.readContract({ address: ctx.contract, abi: postAnchorAbi, functionName: 'anchoredAt', args: [ctx.relayer.address, root] });
}

/** Finds the block of an anchor made by a transaction we have no receipt for (crash recovery), searching back in chunks. */
async function findAnchorBlock(ctx: ChainContext, root: Hex, lookback = 50_000n): Promise<bigint | null> {
  const head = await ctx.publicClient.getBlockNumber();
  for (let to = head; to >= 0n && head - to < lookback; to -= 10_000n) {
    const from = to >= 9_999n ? to - 9_999n : 0n;
    const logs = await ctx.publicClient.getLogs({ address: ctx.contract, event: batchAnchored, args: { sender: ctx.relayer.address, root }, fromBlock: from, toBlock: to });
    if (logs[0]) return logs[0].blockNumber;
    if (from === 0n) break;
  }
  return null;
}

async function markAnchored(deps: Deps, ctx: ChainContext, batch: BatchRow, txHash: Hex | null, blockNumber: bigint | null, timestamp: bigint, note: string) {
  await deps.sql`
    UPDATE batches SET state = 'ANCHORED', tx_hash = ${txHash ? Buffer.from(hexToBytes(txHash)) : null}, block_number = ${blockNumber === null ? null : blockNumber.toString()},
      anchored_at = ${timestamp.toString()}, sender = ${Buffer.from(hexToBytes(ctx.relayer.address))}, updated_at = now()
    WHERE id = ${batch.id}`;
  log.info('batch anchored', { chainId: ctx.config.chainId, batchId: Number(batch.id), posts: batch.post_count, note });
}

async function fail(deps: Deps, ctx: ChainContext, batch: BatchRow, reason: string) {
  await deps.sql`UPDATE batches SET state = 'FAILED', last_error = ${redact(reason)}, updated_at = now() WHERE id = ${batch.id}`;
  log.error('ALERT: anchoring failed', { chainId: ctx.config.chainId, batchId: Number(batch.id), reason: redact(reason) });
}

async function submit(deps: Deps, ctx: ChainContext, batch: BatchRow) {
  const root = bytesToHex(batch.root);
  const args = [root, arweaveIdToBytes32(batch.manifest_arweave_id), batch.post_count] as const;

  // Idempotency after a crash between sending and recording: the root may already be anchored by us.
  const existing = await anchoredAt(ctx, root);
  if (existing > 0n) return markAnchored(deps, ctx, batch, null, await findAnchorBlock(ctx, root), existing, 'already on-chain, adopted');

  let gas: bigint;
  try {
    gas = await ctx.publicClient.estimateContractGas({ address: ctx.contract, abi: postAnchorAbi, functionName: 'anchor', args, account: ctx.relayer });
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    if (revert instanceof ContractFunctionRevertedError) return fail(deps, ctx, batch, `anchor would revert: ${revert.data?.errorName ?? revert.shortMessage}`);
    throw error;
  }
  const nonce = await ctx.publicClient.getTransactionCount({ address: ctx.relayer.address, blockTag: 'pending' });
  const fees = await ctx.publicClient.estimateFeesPerGas();
  const gasLimit = (gas * (100n + ANCHOR_POLICY.gasLimitMarginPercent)) / 100n;
  const hash = await ctx.walletClient.writeContract({
    address: ctx.contract,
    abi: postAnchorAbi,
    functionName: 'anchor',
    args,
    account: ctx.relayer,
    chain: null,
    nonce,
    gas: gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  await deps.sql`
    UPDATE batches SET state = 'SUBMITTED', sender = ${Buffer.from(hexToBytes(ctx.relayer.address))}, nonce = ${nonce}, tx_hash = ${Buffer.from(hexToBytes(hash))},
      tx_history = ${deps.sql.json([hash])}, gas_limit = ${gasLimit.toString()}, max_fee_per_gas = ${fees.maxFeePerGas.toString()}, max_priority_fee = ${fees.maxPriorityFeePerGas.toString()},
      submitted_at = ${deps.now()}, attempts = attempts + 1, updated_at = now()
    WHERE id = ${batch.id}`;
  log.info('anchor submitted', { chainId: ctx.config.chainId, batchId: Number(batch.id), nonce });
}

async function monitor(deps: Deps, ctx: ChainContext, batch: BatchRow) {
  const root = bytesToHex(batch.root);
  // Check every hash sent with this nonce (the original and its replacements) before doing anything else.
  for (const hash of [...batch.tx_history].reverse()) {
    const receipt = await ctx.publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (!receipt) continue;
    const block = await ctx.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.status === 'success') return markAnchored(deps, ctx, batch, hash, receipt.blockNumber, block.timestamp, 'mined');
    const existing = await anchoredAt(ctx, root);
    if (existing > 0n) return markAnchored(deps, ctx, batch, null, await findAnchorBlock(ctx, root), existing, 'reverted as duplicate of an earlier anchor');
    return fail(deps, ctx, batch, `transaction ${hash} reverted`);
  }

  // Nonce consumed without one of our receipts: either it landed under a hash we lost, or something else used it.
  const latestNonce = await ctx.publicClient.getTransactionCount({ address: ctx.relayer.address, blockTag: 'latest' });
  if (BigInt(latestNonce) > BigInt(batch.nonce ?? '0')) {
    const existing = await anchoredAt(ctx, root);
    if (existing > 0n) return markAnchored(deps, ctx, batch, null, await findAnchorBlock(ctx, root), existing, 'nonce consumed, root found on-chain');
    await deps.sql`UPDATE batches SET state = 'READY', nonce = NULL, tx_history = '[]', updated_at = now() WHERE id = ${batch.id}`;
    log.warn('nonce consumed by another transaction; batch requeued', { chainId: ctx.config.chainId, batchId: Number(batch.id) });
    return;
  }

  if (deps.now() - Number(batch.submitted_at) < ANCHOR_POLICY.bumpAfterSeconds) return;
  await replace(deps, ctx, batch);
}

/** Same nonce, higher fees: whichever version lands, the other can never land (ADR-008). */
async function replace(deps: Deps, ctx: ChainContext, batch: BatchRow) {
  const bump = (value: string | null) => (BigInt(value ?? '0') * (100n + ANCHOR_POLICY.feeBumpPercent)) / 100n;
  const fees = await ctx.publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas > bump(batch.max_fee_per_gas) ? fees.maxFeePerGas : bump(batch.max_fee_per_gas);
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas > bump(batch.max_priority_fee) ? fees.maxPriorityFeePerGas : bump(batch.max_priority_fee);
  const root = bytesToHex(batch.root);
  const args = [root, arweaveIdToBytes32(batch.manifest_arweave_id), batch.post_count] as const;
  // Reuse the original gas limit: re-estimating would run against the pending state, where the original transaction
  // has already anchored the root, and revert with AlreadyAnchored. It is read from the row, not from the original
  // transaction, which the node may have dropped from its mempool. Batches submitted before migration 003 have no row value.
  const gasLimit = batch.gas_limit === null ? (await ctx.publicClient.getTransaction({ hash: batch.tx_history[0]! })).gas : BigInt(batch.gas_limit);
  const hash = await ctx.walletClient.writeContract({
    address: ctx.contract,
    abi: postAnchorAbi,
    functionName: 'anchor',
    args,
    account: ctx.relayer,
    chain: null,
    nonce: Number(batch.nonce),
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  await deps.sql`
    UPDATE batches SET tx_hash = ${Buffer.from(hexToBytes(hash))}, tx_history = tx_history || ${deps.sql.json([hash])}, max_fee_per_gas = ${maxFeePerGas.toString()},
      max_priority_fee = ${maxPriorityFeePerGas.toString()}, submitted_at = ${deps.now()}, attempts = attempts + 1, updated_at = now()
    WHERE id = ${batch.id}`;
  log.warn('anchor transaction replaced with higher fees', { chainId: ctx.config.chainId, batchId: Number(batch.id), nonce: Number(batch.nonce) });
}
