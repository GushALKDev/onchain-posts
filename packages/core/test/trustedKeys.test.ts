import { zeroAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { isTrustedKey, relayersForChain, type TrustedKey } from '../src/index.ts';

const relayer = '0x1111111111111111111111111111111111111111';
const receipt = '0x2222222222222222222222222222222222222222';
const keys: TrustedKey[] = [
  { role: 'relayer', chainId: 84532, address: relayer, validFrom: '2026-11-07T00:00:00Z', revokedAt: '2026-11-10T00:00:00Z', note: '' },
  { role: 'receipt', chainId: null, address: receipt, validFrom: '2026-11-07T00:00:00Z', revokedAt: null, note: '' },
  { role: 'relayer', chainId: 421614, address: zeroAddress, validFrom: '2026-11-07T00:00:00Z', revokedAt: null, note: 'placeholder' },
];
const at = (iso: string) => Date.parse(iso) / 1000;

describe('trusted keys', () => {
  it('accepts a relayer inside its window on its own chain only', () => {
    expect(isTrustedKey(keys, { role: 'relayer', address: relayer, chainId: 84532, at: at('2026-11-08T00:00:00Z') })).toBe(true);
    expect(isTrustedKey(keys, { role: 'relayer', address: relayer, chainId: 11155111, at: at('2026-11-08T00:00:00Z') })).toBe(false);
  });

  it('excludes anchors before validFrom and from revokedAt on', () => {
    expect(isTrustedKey(keys, { role: 'relayer', address: relayer, chainId: 84532, at: at('2026-11-06T23:59:59Z') })).toBe(false);
    expect(isTrustedKey(keys, { role: 'relayer', address: relayer, chainId: 84532, at: at('2026-11-10T00:00:00Z') })).toBe(false);
  });

  it('does not let a receipt key pass as a relayer or the reverse', () => {
    expect(isTrustedKey(keys, { role: 'relayer', address: receipt, chainId: 84532, at: at('2026-11-08T00:00:00Z') })).toBe(false);
    expect(isTrustedKey(keys, { role: 'receipt', address: relayer, at: at('2026-11-08T00:00:00Z') })).toBe(false);
    expect(isTrustedKey(keys, { role: 'receipt', address: receipt, at: at('2026-11-08T00:00:00Z') })).toBe(true);
  });

  it('never trusts the zero-address placeholder', () => {
    expect(isTrustedKey(keys, { role: 'relayer', address: zeroAddress, chainId: 421614, at: at('2026-11-08T00:00:00Z') })).toBe(false);
    expect(relayersForChain(keys, 421614)).toEqual([]);
    expect(relayersForChain(keys, 84532)).toEqual([relayer]);
  });
});
