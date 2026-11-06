import { deflateSync } from 'node:zlib';

/**
 * Image files for the venue logo tests (ADR-0030 §4), built byte by byte so each hostile variant breaks
 * exactly one rule. The PNG is a real, decodable image; the JPEG and WebP are structurally complete
 * containers (the server validates structure, a browser decodes them).
 */

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0);
  return out;
};
const le32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
};

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngChunk(type: string, data: Uint8Array = Buffer.alloc(0), badCrc = false): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = crc32(typed) ^ (badCrc ? 1 : 0);
  return Buffer.concat([be32(data.length), typed, be32(crc)]);
}

export interface PngOptions {
  width?: number;
  height?: number;
  /** extra chunks inserted before IDAT */
  before?: Buffer[];
  /** bytes appended after IEND */
  trailing?: Uint8Array;
  /** cut the file to this many bytes */
  truncateTo?: number;
}

/** A solid-colour RGB PNG (3 bytes per pixel, filter 0). */
export function png(options: PngOptions = {}): Buffer {
  const width = options.width ?? 256;
  const height = options.height ?? 256;
  const ihdr = Buffer.concat([be32(width), be32(height), Buffer.from([8, 2, 0, 0, 0])]);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x90)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const file = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...(options.before ?? []),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND'),
    Buffer.from(options.trailing ?? []),
  ]);
  return options.truncateTo === undefined ? file : file.subarray(0, options.truncateTo);
}

// ───────────── JPEG ─────────────

const jpegSegment = (marker: number, body: Uint8Array): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, marker]),
    Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 0xff]),
    Buffer.from(body),
  ]);

export interface JpegOptions {
  width?: number;
  height?: number;
  /** extra segments (e.g. EXIF) inserted after SOI */
  segments?: Buffer[];
  trailing?: Uint8Array;
  omitEoi?: boolean;
  components?: number;
}

export function jpeg(options: JpegOptions = {}): Buffer {
  const width = options.width ?? 256;
  const height = options.height ?? 256;
  const components = options.components ?? 3;
  const sof = Buffer.from([
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    components,
    ...Array.from({ length: components }, (_, i) => [i + 1, 0x11, 0]).flat(),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    ...(options.segments ?? []),
    jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 8)])),
    jpegSegment(0xc0, sof),
    jpegSegment(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16, 0), Buffer.from([0])])),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]), // entropy data, stuffing, a restart
    options.omitEoi ? Buffer.alloc(0) : Buffer.from([0xff, 0xd9]),
    Buffer.from(options.trailing ?? []),
  ]);
}

export const exifSegment = (): Buffer =>
  jpegSegment(0xe1, Buffer.from('Exif\0\0MM\0*\0\0\0\b\0\0', 'latin1'));

// ───────────── WebP ─────────────

const riffChunk = (type: string, body: Uint8Array): Buffer =>
  Buffer.concat([
    Buffer.from(type, 'latin1'),
    le32(body.length),
    Buffer.from(body),
    body.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);

const riff = (chunks: Buffer[], extra = 0): Buffer => {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), le32(body.length + extra), body]);
};

/** A lossless (VP8L) bitstream header for the given size, padded; enough for the container checks. */
const vp8l = (width: number, height: number): Buffer => {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return Buffer.concat([Buffer.from([0x2f]), le32(bits), Buffer.alloc(16, 1)]);
};

const vp8 = (width: number, height: number): Buffer =>
  Buffer.from([
    0x10,
    0x02,
    0x00,
    0x9d,
    0x01,
    0x2a,
    width & 0xff,
    (width >> 8) & 0x3f,
    height & 0xff,
    (height >> 8) & 0x3f,
    ...Array.from({ length: 12 }, () => 0),
  ]);

export interface WebpOptions {
  width?: number;
  height?: number;
  lossy?: boolean;
  /** VP8X flags byte (animation 0x02, EXIF 0x08, ICC 0x20 ...) */
  flags?: number;
  /** extra chunk, e.g. ANIM or EXIF */
  extra?: Buffer;
  trailing?: Uint8Array;
}

export function webp(options: WebpOptions = {}): Buffer {
  const width = options.width ?? 256;
  const height = options.height ?? 256;
  const stream = options.lossy
    ? riffChunk('VP8 ', vp8(width, height))
    : riffChunk('VP8L', vp8l(width, height));
  const header =
    options.flags === undefined
      ? []
      : [
          riffChunk(
            'VP8X',
            Buffer.from([
              options.flags,
              0,
              0,
              0,
              (width - 1) & 0xff,
              ((width - 1) >> 8) & 0xff,
              ((width - 1) >> 16) & 0xff,
              (height - 1) & 0xff,
              ((height - 1) >> 8) & 0xff,
              ((height - 1) >> 16) & 0xff,
            ]),
          ),
        ];
  const file = riff([...header, ...(options.extra ? [options.extra] : []), stream]);
  return options.trailing ? Buffer.concat([file, Buffer.from(options.trailing)]) : file;
}

export { riff, riffChunk };

// ───────────── other formats ─────────────

export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><script>alert(1)</script></svg>',
);
export const GIF = Buffer.concat([
  Buffer.from('GIF89a', 'latin1'),
  Buffer.from([
    0, 1, 0, 1, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44,
    1, 0, 0x3b,
  ]),
]);
export const HTML_AS_PNG = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');
