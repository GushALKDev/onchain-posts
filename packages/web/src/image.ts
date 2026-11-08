import { LIMITS, inspectWebp, stripWebpMetadata } from '@phi/core';

/** Lowest WebP quality tried before rejecting (design parameter, ADR-003). */
export const MIN_QUALITY = 0.5;
const QUALITIES = [0.9, 0.8, 0.7, 0.6, MIN_QUALITY];

export type PreparedImage = { bytes: Uint8Array; width: number; height: number; quality: number };

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the image'))), 'image/webp', quality));
}

/**
 * Resizes to at most 1080 px per side and re-encodes as WebP, lowering the quality until the file fits in 95 KiB;
 * re-encoding drops EXIF and XMP, and the shared RIFF parser strips and checks again. Rejects if it never fits.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LIMITS.imageMaxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of QUALITIES) {
    const blob = await toBlob(canvas, quality);
    if (blob.type !== 'image/webp') throw new Error('this browser cannot encode WebP; use a recent Chrome or Firefox');
    if (blob.size > LIMITS.imageMaxBytes) continue;
    const bytes = stripWebpMetadata(new Uint8Array(await blob.arrayBuffer()));
    const info = inspectWebp(bytes);
    if (info.disallowed.length > 0) throw new Error(`encoder produced chunks outside the allowlist: ${info.disallowed.join(', ')}`);
    return { bytes, width: info.width, height: info.height, quality };
  }
  throw new Error(`the image does not fit in ${LIMITS.imageMaxBytes / 1024} KiB even at quality ${MIN_QUALITY}: crop it or use a simpler image`);
}
