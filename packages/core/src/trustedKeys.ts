import { zeroAddress, type Address } from 'viem';
import type { TrustedKey } from './schemas.ts';

export type TrustQuery = {
  role: TrustedKey['role'];
  address: Address;
  /** Required for relayer keys, ignored for receipt keys. */
  chainId?: number;
  /** Relayer keys: block.timestamp of the anchor. Receipt keys: the receipt's self-declared acceptedAt (consistency check only, ADR-015). */
  at: number;
};

/** True if `address` is listed for `role` (and chain) with `at` inside [validFrom, revokedAt). */
export function isTrustedKey(keys: readonly TrustedKey[], query: TrustQuery): boolean {
  if (query.address.toLowerCase() === zeroAddress) return false;
  return keys.some((key) => {
    if (key.role !== query.role || key.address.toLowerCase() !== query.address.toLowerCase()) return false;
    if (key.role === 'relayer' && key.chainId !== query.chainId) return false;
    const from = Date.parse(key.validFrom) / 1000;
    const until = key.revokedAt === null ? Number.POSITIVE_INFINITY : Date.parse(key.revokedAt) / 1000;
    return query.at >= from && query.at < until;
  });
}

export function relayersForChain(keys: readonly TrustedKey[], chainId: number): Address[] {
  return keys.filter((key) => key.role === 'relayer' && key.chainId === chainId && key.address.toLowerCase() !== zeroAddress).map((key) => key.address as Address);
}
