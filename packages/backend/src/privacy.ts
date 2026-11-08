import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { bytesToHex, hexToBytes, type Address, type Hex } from 'viem';

/**
 * The database is the privacy boundary (ADR-013): it stores HMAC(signerAddress, DB_HMAC_SECRET) instead of the address,
 * so a dump without the secret, which lives outside the database, does not reveal who posted what.
 */
export function hmacAddress(secret: string, address: Address): Buffer {
  return createHmac('sha256', secret).update(address.toLowerCase()).digest();
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM with the postHash as additional data, so an encrypted signature cannot be moved to another post's row.
 * Layout: iv (12) || ciphertext || tag (16).
 */
export function encryptSignature(key: Uint8Array, postHash: Hex, signature: Hex): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(hexToBytes(postHash));
  const ciphertext = Buffer.concat([cipher.update(hexToBytes(signature)), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

export function decryptSignature(key: Uint8Array, postHash: Hex, blob: Uint8Array): Hex {
  const data = Buffer.from(blob);
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, IV_BYTES));
  decipher.setAAD(hexToBytes(postHash));
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
  return bytesToHex(Buffer.concat([decipher.update(data.subarray(IV_BYTES, data.length - TAG_BYTES)), decipher.final()]));
}
