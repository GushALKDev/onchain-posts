import { RECEIPTS_DOMAIN, RECEIPT_TYPES, receiptFromJson, type SignedReceipt } from '@phi/core';
import type { Account, Hex } from 'viem';
import { RECEIPT_BUDGET, type ChainConfig } from './config.ts';

/** anchorBy per chain = acceptedAt + storage budget + that chain's Tmax + submission + inclusion margins (ADR-006). */
export function anchorByFor(acceptedAt: number, chain: ChainConfig): number {
  return acceptedAt + RECEIPT_BUDGET.storageSeconds + chain.tmaxSeconds + RECEIPT_BUDGET.submissionSeconds + RECEIPT_BUDGET.inclusionSeconds;
}

/** Signs the receipt with the dedicated receipt key under the "Phi Receipts" domain (ADR-015). */
export async function signReceipt(account: Account, unsigned: Omit<SignedReceipt, 'signature'>): Promise<SignedReceipt> {
  if (!account.signTypedData) throw new Error('receipt account cannot sign typed data');
  const message = receiptFromJson({ ...unsigned, signature: '0x' });
  const signature: Hex = await account.signTypedData({ domain: RECEIPTS_DOMAIN, types: RECEIPT_TYPES, primaryType: 'Receipt', message });
  return { ...unsigned, signature };
}
