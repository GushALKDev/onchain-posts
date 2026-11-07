/**
 * Minimal WebP (RIFF) container parser shared by the client (to strip metadata before signing) and the server
 * (to reject anything that is not a plain still image). The server uses an allowlist, not a denylist (ADR-003).
 */

/** Chunks needed to render a still image; everything else (EXIF, XMP, ICCP, ANIM, ANMF, unknown) is rejected or stripped. */
export const ALLOWED_WEBP_CHUNKS: readonly string[] = ['VP8 ', 'VP8L', 'VP8X', 'ALPH'];

export type WebpChunk = { fourCC: string; offset: number; size: number };
export type WebpInfo = { width: number; height: number; chunks: WebpChunk[]; disallowed: string[] };

// VP8X flags byte: bits 5..1 are ICC, alpha, EXIF, XMP, animation.
const VP8X_ICC = 0x20;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;
const VP8X_ANIMATION = 0x02;

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24 = (b: Uint8Array, i: number) => u16(b, i) | ((b[i + 2] ?? 0) << 16);
const u32 = (b: Uint8Array, i: number) => (u24(b, i) | ((b[i + 3] ?? 0) << 24)) >>> 0;

/** Lists the chunks of a WebP file; throws on anything that is not a well-formed RIFF/WEBP container. */
export function parseWebpChunks(bytes: Uint8Array): WebpChunk[] {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') throw new Error('not a RIFF/WEBP file');
  if (u32(bytes, 4) + 8 !== bytes.length) throw new Error('RIFF size does not match the file length');

  const chunks: WebpChunk[] = [];
  let cursor = 12;
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) throw new Error('truncated chunk header');
    const size = u32(bytes, cursor + 4);
    const end = cursor + 8 + size;
    if (end > bytes.length) throw new Error('chunk extends past the end of the file');
    chunks.push({ fourCC: ascii(bytes, cursor, 4), offset: cursor + 8, size });
    cursor = end + (size & 1); // chunks are padded to an even size
  }
  if (cursor !== bytes.length) throw new Error('missing padding byte');

  const bitstreams = chunks.filter((c) => c.fourCC === 'VP8 ' || c.fourCC === 'VP8L');
  if (bitstreams.length !== 1) throw new Error(`expected exactly one image bitstream, found ${bitstreams.length}`);
  return chunks;
}

function dimensions(bytes: Uint8Array, chunks: WebpChunk[]): { width: number; height: number } {
  const vp8x = chunks.find((c) => c.fourCC === 'VP8X');
  if (vp8x) return { width: 1 + u24(bytes, vp8x.offset + 4), height: 1 + u24(bytes, vp8x.offset + 7) };

  const lossy = chunks.find((c) => c.fourCC === 'VP8 ');
  if (lossy) {
    const p = lossy.offset;
    if (bytes[p + 3] !== 0x9d || bytes[p + 4] !== 0x01 || bytes[p + 5] !== 0x2a) throw new Error('invalid VP8 start code');
    return { width: u16(bytes, p + 6) & 0x3fff, height: u16(bytes, p + 8) & 0x3fff };
  }

  const lossless = chunks.find((c) => c.fourCC === 'VP8L');
  if (!lossless || bytes[lossless.offset] !== 0x2f) throw new Error('invalid VP8L signature');
  const bits = u32(bytes, lossless.offset + 1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

/** Server-side inspection: dimensions plus every chunk outside the allowlist. */
export function inspectWebp(bytes: Uint8Array): WebpInfo {
  const chunks = parseWebpChunks(bytes);
  const disallowed = chunks.map((c) => c.fourCC).filter((fourCC) => !ALLOWED_WEBP_CHUNKS.includes(fourCC));
  const vp8x = chunks.find((c) => c.fourCC === 'VP8X');
  if (vp8x && ((bytes[vp8x.offset] ?? 0) & VP8X_ANIMATION) !== 0) disallowed.push('VP8X:animation');
  return { ...dimensions(bytes, chunks), chunks, disallowed };
}

/** Client-side: rebuilds the file with allowlisted chunks only and clears the ICC, EXIF and XMP flags. */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const chunks = parseWebpChunks(bytes);
  const vp8x = chunks.find((c) => c.fourCC === 'VP8X');
  if (vp8x && ((bytes[vp8x.offset] ?? 0) & VP8X_ANIMATION) !== 0) throw new Error('animated WebP is not supported');

  const kept = chunks.filter((c) => ALLOWED_WEBP_CHUNKS.includes(c.fourCC));
  const length = 12 + kept.reduce((sum, c) => sum + 8 + c.size + (c.size & 1), 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  out.set(bytes.subarray(0, 4), 0);
  view.setUint32(4, length - 8, true);
  out.set(bytes.subarray(8, 12), 8);

  let cursor = 12;
  for (const chunk of kept) {
    out.set(bytes.subarray(chunk.offset - 8, chunk.offset + chunk.size), cursor);
    if (chunk.fourCC === 'VP8X') out[cursor + 8] = (out[cursor + 8] ?? 0) & ~(VP8X_ICC | VP8X_EXIF | VP8X_XMP);
    cursor += 8 + chunk.size + (chunk.size & 1);
  }
  return out;
}
