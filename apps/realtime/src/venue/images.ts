import { inflateSync } from 'node:zlib';

/**
 * Venue images (ADR-0030 §4): a structural validator for the only three formats a café may upload.
 *
 * The server has no image library and does not re-encode, so the whole container is parsed here and
 * anything that is not exactly a plain still PNG, JPEG or WebP is refused: no SVG (script), no GIF, no
 * animation, no metadata blocks (EXIF/ICC/text chunks can carry anything), no bytes after the end marker
 * (a polyglot would hide a second format there), no lying lengths or checksums. The format is decided by
 * the magic bytes alone, never by a name or a claimed content type.
 */

export const IMAGE_TYPES = ['image/png', 'image/webp', 'image/jpeg'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The most one image may weigh, and the most pixels it may hold (decoder memory is width x height). */
export const MAX_IMAGE_BYTES = 300 * 1024;
export const MAX_IMAGE_PIXELS = 1_600_000;
export const TEAM_MARK = { min: 64, max: 1024, maxRatio: 1.25 } as const;
export const LOGO_BOX = { minSide: 32, maxWidth: 1600, maxHeight: 600 } as const;

export type ImageKind = 'LOGO' | 'TEAM';

/** Why a file was refused: its structure, its weight, or its size in pixels. */
export type ImageReason = 'FORMAT' | 'SIZE' | 'DIMENSIONS';

export class ImageRejected extends Error {
  constructor(
    readonly reason: ImageReason,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

export interface ParsedImage {
  contentType: ImageType;
  width: number;
  height: number;
}

const reject = (detail: string): never => {
  throw new ImageRejected('FORMAT', detail);
};

// ───────────── entry point ─────────────

export function parseImage(bytes: Uint8Array): ParsedImage {
  if (bytes.length === 0) return reject('empty');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageRejected('SIZE', 'too large');
  const image = sniff(bytes);
  if (image.width < 1 || image.height < 1) return reject('no pixels');
  if (image.width * image.height > MAX_IMAGE_PIXELS)
    throw new ImageRejected('DIMENSIONS', 'too many pixels');
  return image;
}

function sniff(bytes: Uint8Array): ParsedImage {
  if (startsWith(bytes, PNG_MAGIC)) return parsePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return parseJpeg(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return parseWebp(bytes);
  return reject('unknown format');
}

/** The slot's size rules (team marks are near-square badges, the venue logo a wide strip). */
export function checkDimensions(kind: ImageKind, width: number, height: number): boolean {
  if (kind === 'TEAM') {
    const small = Math.min(width, height);
    const large = Math.max(width, height);
    return small >= TEAM_MARK.min && large <= TEAM_MARK.max && large / small <= TEAM_MARK.maxRatio;
  }
  return (
    width >= LOGO_BOX.minSide &&
    height >= LOGO_BOX.minSide &&
    width <= LOGO_BOX.maxWidth &&
    height <= LOGO_BOX.maxHeight
  );
}

/** Parse and check one slot. */
export function parseImageFor(bytes: Uint8Array, kind: ImageKind): ParsedImage {
  const image = parseImage(bytes);
  if (!checkDimensions(kind, image.width, image.height))
    throw new ImageRejected('DIMENSIONS', `${image.width}x${image.height} for ${kind}`);
  return image;
}

// ───────────── helpers ─────────────

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const u32be = (bytes: Uint8Array, at: number): number =>
  ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const u16be = (bytes: Uint8Array, at: number): number => (bytes[at]! << 8) | bytes[at + 1]!;
const u24le = (bytes: Uint8Array, at: number): number =>
  bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
const u32le = (bytes: Uint8Array, at: number): number =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ───────────── PNG ─────────────

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Everything else (text, ICC, EXIF, APNG's acTL/fcTL/fdAT, private chunks) is refused. */
const PNG_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB', 'gAMA', 'pHYs']);
/** colour type -> allowed bit depths, and samples per pixel */
const PNG_COLOR: Record<number, { depths: readonly number[]; samples: number }> = {
  0: { depths: [1, 2, 4, 8, 16], samples: 1 },
  2: { depths: [8, 16], samples: 3 },
  3: { depths: [1, 2, 4, 8], samples: 1 },
  4: { depths: [8, 16], samples: 2 },
  6: { depths: [8, 16], samples: 4 },
};

function parsePng(bytes: Uint8Array): ParsedImage {
  let at = PNG_MAGIC.length;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let depth = 0;
  let sawPlte = false;
  let sawIdat = false;
  let idatEnded = false;
  let ended = false;
  const idat: Uint8Array[] = [];
  let first = true;
  while (at < bytes.length) {
    if (ended) return reject('data after IEND');
    if (at + 12 > bytes.length) return reject('truncated chunk header');
    const length = u32be(bytes, at);
    if (length > 0x7fffffff || at + 12 + length > bytes.length) return reject('chunk past the end');
    const type = ascii(bytes, at + 4, 4);
    if (!PNG_CHUNKS.has(type)) return reject(`chunk ${type}`);
    if (first !== (type === 'IHDR')) return reject('IHDR must be first and only once');
    first = false;
    const dataStart = at + 8;
    if (crc32(bytes, at + 4, dataStart + length) !== u32be(bytes, dataStart + length))
      return reject('bad checksum');
    switch (type) {
      case 'IHDR': {
        if (length !== 13) return reject('IHDR length');
        width = u32be(bytes, dataStart);
        height = u32be(bytes, dataStart + 4);
        depth = bytes[dataStart + 8]!;
        colorType = bytes[dataStart + 9]!;
        const compression = bytes[dataStart + 10]!;
        const filter = bytes[dataStart + 11]!;
        const interlace = bytes[dataStart + 12]!;
        const spec = PNG_COLOR[colorType];
        if (!spec || !spec.depths.includes(depth)) return reject('colour type / depth');
        if (compression !== 0 || filter !== 0 || interlace !== 0)
          return reject('compression, filter or interlace');
        if (width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff)
          return reject('IHDR size');
        // Refuse a giant canvas before anything is inflated.
        if (width * height > MAX_IMAGE_PIXELS)
          throw new ImageRejected('DIMENSIONS', 'too many pixels');
        break;
      }
      case 'PLTE':
        if (sawIdat || sawPlte) return reject('PLTE order');
        if (colorType === 0 || colorType === 4) return reject('PLTE for grey');
        if (length === 0 || length % 3 !== 0 || length > 768) return reject('PLTE length');
        sawPlte = true;
        break;
      case 'IDAT':
        if (idatEnded) return reject('IDAT not contiguous');
        sawIdat = true;
        idat.push(bytes.subarray(dataStart, dataStart + length));
        break;
      case 'IEND':
        if (length !== 0) return reject('IEND length');
        ended = true;
        break;
      default:
        // sRGB, gAMA, pHYs, tRNS sit between IHDR and the first IDAT, or (for the ancillary ones) before IEND.
        if (sawIdat) idatEnded = true;
        if (type === 'tRNS' && sawIdat) return reject('tRNS after IDAT');
    }
    if (type !== 'IDAT' && sawIdat) idatEnded = true;
    at = dataStart + length + 4;
  }
  if (!ended) return reject('no IEND');
  if (colorType === 3 && !sawPlte) return reject('palette image without PLTE');
  if (!sawIdat) return reject('no pixel data');
  // The pixel stream must inflate to exactly the size the header promises (no bomb, no short data).
  const rowBytes = Math.ceil((width * PNG_COLOR[colorType]!.samples * depth) / 8);
  const expected = height * (rowBytes + 1);
  try {
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
    if (raw.length !== expected) return reject('pixel data size');
  } catch {
    return reject('pixel data');
  }
  return { contentType: 'image/png', width, height };
}

// ───────────── JPEG ─────────────

function parseJpeg(bytes: Uint8Array): ParsedImage {
  let at = 2; // after SOI
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;
  let sawQuant = false;
  let sawHuffman = false;
  let ended = false;
  while (at < bytes.length) {
    if (ended) return reject('data after EOI');
    if (bytes[at] !== 0xff) return reject('marker expected');
    while (bytes[at] === 0xff) at += 1; // fill bytes
    const marker = bytes[at];
    if (marker === undefined) return reject('truncated');
    at += 1;
    if (marker === 0xd9) {
      ended = true;
      continue;
    }
    // Markers without a length: RSTn and TEM do not appear between segments of a still image.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8))
      return reject('stray marker');
    if (at + 2 > bytes.length) return reject('truncated segment');
    const length = u16be(bytes, at);
    if (length < 2 || at + length > bytes.length) return reject('segment past the end');
    const body = at + 2;
    const end = at + length;
    switch (marker) {
      case 0xe0: // APP0: JFIF only
        if (ascii(bytes, body, 5) !== 'JFIF\0') return reject('APP0 is not JFIF');
        break;
      case 0xee: // APP14: Adobe colour transform marker only (12 bytes)
        if (ascii(bytes, body, 5) !== 'Adobe' || length !== 14) return reject('APP14 is not Adobe');
        break;
      case 0xdb:
        sawQuant = true;
        break;
      case 0xc4:
        sawHuffman = true;
        break;
      case 0xdd: // DRI
        if (length !== 4) return reject('DRI length');
        break;
      case 0xc0:
      case 0xc1:
      case 0xc2: {
        // baseline, extended sequential, progressive (Huffman); lossless and arithmetic are refused
        if (sawFrame) return reject('two frames');
        if (length < 8 || bytes[body] !== 8) return reject('sample precision');
        height = u16be(bytes, body + 1);
        width = u16be(bytes, body + 3);
        const components = bytes[body + 5]!;
        if ((components !== 1 && components !== 3) || length !== 8 + components * 3)
          return reject('components');
        if (width < 1 || height < 1) return reject('frame size');
        sawFrame = true;
        break;
      }
      case 0xda: {
        if (!sawFrame) return reject('scan before frame');
        sawScan = true;
        // Entropy-coded data runs to the next real marker (FF 00 is stuffing, FF D0..D7 a restart).
        let scan = end;
        for (;;) {
          if (scan + 1 >= bytes.length) return reject('truncated scan');
          if (bytes[scan] === 0xff) {
            const next = bytes[scan + 1]!;
            if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
              scan += next === 0xff ? 1 : 2;
              continue;
            }
            break;
          }
          scan += 1;
        }
        at = scan;
        continue;
      }
      default:
        // APP1 (EXIF/XMP), APP2 (ICC), other APPn, COM, DNL, JPEG-LS, hierarchical, arithmetic: all refused.
        return reject(`marker ${marker.toString(16)}`);
    }
    at = end;
  }
  if (!ended) return reject('no EOI');
  if (!sawFrame || !sawScan || !sawQuant || !sawHuffman) return reject('incomplete JPEG');
  return { contentType: 'image/jpeg', width, height };
}

// ───────────── WebP ─────────────

const VP8X_ICC = 0x20;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;
const VP8X_ANIMATION = 0x02;

function parseWebp(bytes: Uint8Array): ParsedImage {
  if (bytes.length < 20) return reject('truncated');
  // The RIFF size must account for every byte: nothing may follow the container.
  if (u32le(bytes, 4) + 8 !== bytes.length || bytes.length % 2 !== 0) return reject('RIFF size');
  let at = 12;
  let canvas: { width: number; height: number } | null = null;
  let bitstream: { width: number; height: number } | null = null;
  let index = 0;
  let sawAlpha = false;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return reject('truncated chunk');
    const type = ascii(bytes, at, 4);
    const size = u32le(bytes, at + 4);
    const body = at + 8;
    if (body + size > bytes.length) return reject('chunk past the end');
    const next = body + size + (size % 2);
    if (next > bytes.length) return reject('chunk padding');
    switch (type) {
      case 'VP8X': {
        if (index !== 0 || size !== 10) return reject('VP8X');
        const flags = bytes[body]!;
        if (flags & (VP8X_ICC | VP8X_EXIF | VP8X_XMP | VP8X_ANIMATION))
          return reject('VP8X flags (animation, ICC, EXIF or XMP)');
        canvas = { width: u24le(bytes, body + 4) + 1, height: u24le(bytes, body + 7) + 1 };
        break;
      }
      case 'ALPH':
        if (canvas === null || bitstream !== null || sawAlpha) return reject('ALPH order');
        sawAlpha = true;
        break;
      case 'VP8 ':
      case 'VP8L': {
        if (bitstream !== null) return reject('two bitstreams');
        if (index > 0 && canvas === null) return reject('bitstream order');
        bitstream = type === 'VP8L' ? vp8lSize(bytes, body, size) : vp8Size(bytes, body, size);
        break;
      }
      default:
        // ANIM, ANMF (animation), ICCP, EXIF, XMP and anything unknown
        return reject(`chunk ${type.trim()}`);
    }
    index += 1;
    at = next;
  }
  if (bitstream === null) return reject('no bitstream');
  if (canvas !== null && (canvas.width !== bitstream.width || canvas.height !== bitstream.height))
    return reject('canvas and bitstream differ');
  return { contentType: 'image/webp', ...bitstream };
}

function vp8Size(bytes: Uint8Array, at: number, size: number): { width: number; height: number } {
  if (size < 10) return reject('VP8 too short');
  // frame tag: bit 0 = 0 for a key frame; then the start code 9D 01 2A and 14-bit sizes
  if ((bytes[at]! & 1) !== 0) return reject('VP8 is not a key frame');
  if (bytes[at + 3] !== 0x9d || bytes[at + 4] !== 0x01 || bytes[at + 5] !== 0x2a)
    return reject('VP8 start code');
  return {
    width: (bytes[at + 6]! | (bytes[at + 7]! << 8)) & 0x3fff,
    height: (bytes[at + 8]! | (bytes[at + 9]! << 8)) & 0x3fff,
  };
}

function vp8lSize(bytes: Uint8Array, at: number, size: number): { width: number; height: number } {
  if (size < 5 || bytes[at] !== 0x2f) return reject('VP8L signature');
  const bits = u32le(bytes, at + 1);
  if (bits >>> 29 !== 0) return reject('VP8L version');
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}
