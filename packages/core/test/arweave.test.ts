import { describe, expect, it } from 'vitest';
import { arweaveIdToBytes32, bytes32ToArweaveId } from '../src/index.ts';
import { sampleArweaveId } from './helpers.ts';

describe('Arweave IDs', () => {
  it('round-trips a 43-character ID through 32 bytes', () => {
    const id = sampleArweaveId('round trip');
    const value = arweaveIdToBytes32(id);
    expect(value).toMatch(/^0x[0-9a-f]{64}$/);
    expect(bytes32ToArweaveId(value)).toBe(id);
  });

  it('rejects IDs of the wrong length or alphabet', () => {
    expect(() => arweaveIdToBytes32('short')).toThrow(/invalid Arweave ID/);
    expect(() => arweaveIdToBytes32(`${'A'.repeat(42)}=`)).toThrow(/invalid Arweave ID/);
  });

  it('rejects a non-canonical ID that would alias another one', () => {
    const id = sampleArweaveId('canonical');
    const last = id.at(-1)!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    // Setting one of the 2 unused low bits of the last character changes the string but not the bytes.
    const alias = id.slice(0, -1) + alphabet[alphabet.indexOf(last) | 1];
    if (alias !== id) expect(() => arweaveIdToBytes32(alias)).toThrow(/non-canonical/);
  });
});
