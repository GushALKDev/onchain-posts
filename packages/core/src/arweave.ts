import { bytesToHex, hexToBytes, type Hex } from 'viem';

const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

/** Decodes a 43-character base64url Arweave ID to 32 bytes, rejecting non-canonical encodings. */
export function arweaveIdToBytes32(id: string): Hex {
  if (!ARWEAVE_ID.test(id)) throw new Error(`invalid Arweave ID: ${id}`);
  const binary = atob(`${id.replace(/-/g, '+').replace(/_/g, '/')}=`);
  const value = bytesToHex(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  // 43 characters carry 258 bits; two IDs differing only in the 2 unused bits would map to the same bytes.
  if (bytes32ToArweaveId(value) !== id) throw new Error(`non-canonical Arweave ID: ${id}`);
  return value;
}

export function bytes32ToArweaveId(value: Hex): string {
  const bytes = hexToBytes(value);
  if (bytes.length !== 32) throw new Error(`expected 32 bytes, got ${bytes.length}`);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
