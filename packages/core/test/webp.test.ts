import { toBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { inspectWebp, parseWebpChunks, stripWebpMetadata } from '../src/index.ts';
import { buildWebp, vp8, vp8x } from './helpers.ts';

const EXIF = { fourCC: 'EXIF', payload: toBytes('Exif\0\0GPS 40.4168 N 3.7038 W') };
const XMP = { fourCC: 'XMP ', payload: toBytes('<x:xmpmeta>camera</x:xmpmeta>') };
const ICCP = { fourCC: 'ICCP', payload: new Uint8Array(7) };

describe('WebP parsing', () => {
  it('reads dimensions of a simple lossy file', () => {
    const info = inspectWebp(buildWebp([{ fourCC: 'VP8 ', payload: vp8(1080, 720) }]));
    expect(info).toMatchObject({ width: 1080, height: 720, disallowed: [] });
  });

  it('reads dimensions from VP8X when present', () => {
    const info = inspectWebp(buildWebp([{ fourCC: 'VP8X', payload: vp8x(0, 1080, 1080) }, { fourCC: 'VP8 ', payload: vp8(1080, 1080) }]));
    expect(info).toMatchObject({ width: 1080, height: 1080 });
  });

  it('lists EXIF, XMP and every other non-allowlisted chunk', () => {
    const file = buildWebp([{ fourCC: 'VP8X', payload: vp8x(0x2c, 800, 600) }, ICCP, { fourCC: 'VP8 ', payload: vp8(800, 600) }, EXIF, XMP]);
    expect(inspectWebp(file).disallowed).toEqual(['ICCP', 'EXIF', 'XMP ']);
  });

  it('flags animation', () => {
    const file = buildWebp([{ fourCC: 'VP8X', payload: vp8x(0x02, 10, 10) }, { fourCC: 'VP8 ', payload: vp8(10, 10) }]);
    expect(inspectWebp(file).disallowed).toContain('VP8X:animation');
    expect(() => stripWebpMetadata(file)).toThrow(/animated/);
  });

  it('rejects malformed containers', () => {
    expect(() => parseWebpChunks(toBytes('not a webp file at all'))).toThrow(/RIFF/);
    const good = buildWebp([{ fourCC: 'VP8 ', payload: vp8(10, 10) }]);
    expect(() => parseWebpChunks(good.subarray(0, good.length - 2))).toThrow(/size/);
    expect(() => parseWebpChunks(buildWebp([EXIF]))).toThrow(/bitstream/);
    expect(() => parseWebpChunks(buildWebp([{ fourCC: 'VP8 ', payload: vp8(1, 1) }, { fourCC: 'VP8L', payload: Uint8Array.from([0x2f, 0, 0, 0, 0]) }]))).toThrow(/bitstream/);
  });
});

describe('WebP metadata stripping', () => {
  it('removes metadata chunks, clears the VP8X flags and leaves a clean file', () => {
    const file = buildWebp([{ fourCC: 'VP8X', payload: vp8x(0x2c, 800, 600) }, ICCP, { fourCC: 'VP8 ', payload: vp8(800, 600) }, EXIF, XMP]);
    const clean = stripWebpMetadata(file);
    const info = inspectWebp(clean);
    expect(info.disallowed).toEqual([]);
    expect(info.chunks.map((c) => c.fourCC)).toEqual(['VP8X', 'VP8 ']);
    expect(clean[20]! & 0x2c).toBe(0);
    expect(info).toMatchObject({ width: 800, height: 600 });
  });

  it('is a no-op on a file without metadata', () => {
    const file = buildWebp([{ fourCC: 'VP8 ', payload: vp8(64, 64) }]);
    expect(stripWebpMetadata(file)).toEqual(file);
  });
});
