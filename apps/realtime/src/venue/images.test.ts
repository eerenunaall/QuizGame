import { describe, expect, it } from 'vitest';
import {
  GIF,
  HTML_AS_PNG,
  PNG_SIGNATURE,
  SVG,
  exifSegment,
  jpeg,
  png,
  pngChunk,
  riffChunk,
  webp,
} from '../../../../tests/helpers/images';
import { ImageRejected, MAX_IMAGE_BYTES, parseImage, parseImageFor } from './images';

/** The venue image validator (ADR-0030 §4): the whole container is parsed, anything unusual is refused. */
const reasonOf = (bytes: Uint8Array, kind: 'LOGO' | 'TEAM' = 'LOGO'): string => {
  try {
    parseImageFor(bytes, kind);
  } catch (error) {
    if (error instanceof ImageRejected) return error.reason;
    throw error;
  }
  return 'ACCEPTED';
};

describe('accepted files', () => {
  it('reads the real size from the header of a PNG, a JPEG and a WebP (lossless, lossy, extended)', () => {
    expect(parseImage(png({ width: 300, height: 120 }))).toEqual({
      contentType: 'image/png',
      width: 300,
      height: 120,
    });
    expect(parseImage(jpeg({ width: 500, height: 200 }))).toEqual({
      contentType: 'image/jpeg',
      width: 500,
      height: 200,
    });
    expect(parseImage(webp({ width: 128, height: 128 }))).toMatchObject({
      contentType: 'image/webp',
      width: 128,
      height: 128,
    });
    expect(parseImage(webp({ width: 130, height: 90, lossy: true }))).toMatchObject({
      width: 130,
      height: 90,
    });
    expect(parseImage(webp({ width: 64, height: 64, flags: 0x10 }))).toMatchObject({ width: 64 });
  });

  it('applies the slot rules: team marks near-square 64 to 1024, the logo up to 1600 x 600', () => {
    expect(reasonOf(png({ width: 256, height: 256 }), 'TEAM')).toBe('ACCEPTED');
    expect(reasonOf(png({ width: 1024, height: 1024 }), 'TEAM')).toBe('ACCEPTED');
    expect(reasonOf(png({ width: 1100, height: 1100 }), 'TEAM')).toBe('DIMENSIONS');
    expect(reasonOf(png({ width: 63, height: 64 }), 'TEAM')).toBe('DIMENSIONS');
    expect(reasonOf(png({ width: 400, height: 100 }), 'TEAM')).toBe('DIMENSIONS');
    expect(reasonOf(png({ width: 1600, height: 600 }), 'LOGO')).toBe('ACCEPTED');
    expect(reasonOf(png({ width: 1601, height: 600 }), 'LOGO')).toBe('DIMENSIONS');
    expect(reasonOf(png({ width: 800, height: 601 }), 'LOGO')).toBe('DIMENSIONS');
  });
});

describe('hostile files', () => {
  it('refuses SVG, GIF and HTML renamed to .png by their content, whatever they are called', () => {
    for (const bytes of [SVG, GIF, HTML_AS_PNG, Buffer.from('GIF89a')]) {
      expect(reasonOf(bytes)).toBe('FORMAT');
    }
    expect(reasonOf(Buffer.alloc(0))).toBe('FORMAT');
    expect(reasonOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('FORMAT');
    // right extension-like start, wrong magic
    expect(reasonOf(Buffer.concat([Buffer.from('XPNG'), png().subarray(4)]))).toBe('FORMAT');
  });

  it('refuses a truncated PNG, a bad checksum, a lying length and bytes after IEND', () => {
    const whole = png();
    expect(reasonOf(png({ truncateTo: whole.length - 20 }))).toBe('FORMAT');
    expect(reasonOf(png({ truncateTo: 40 }))).toBe('FORMAT');
    expect(reasonOf(png({ trailing: Buffer.from('<script>') }))).toBe('FORMAT');
    expect(reasonOf(png({ trailing: Buffer.from([0]) }))).toBe('FORMAT');
    const corrupt = Buffer.from(whole);
    corrupt.writeUInt8(corrupt.readUInt8(corrupt.length - 20) ^ 0xff, corrupt.length - 20); // inside IDAT or its CRC
    expect(reasonOf(corrupt)).toBe('FORMAT');
    expect(reasonOf(png({ before: [pngChunk('IDAT', Buffer.alloc(3), true)] }))).toBe('FORMAT');
    // a chunk length that points past the end of the file
    const long = Buffer.from(whole);
    long.writeUInt32BE(0x7fffff00, 8 + 8 + 13 + 4);
    expect(reasonOf(long)).toBe('FORMAT');
  });

  it('refuses PNG metadata and animation chunks (text, ICC, EXIF, APNG)', () => {
    for (const type of ['tEXt', 'iTXt', 'zTXt', 'iCCP', 'eXIf', 'acTL', 'fcTL', 'fdAT', 'prVt'])
      expect(reasonOf(png({ before: [pngChunk(type, Buffer.from('x\0y'))] })), type).toBe('FORMAT');
  });

  it('refuses a PNG whose pixel data does not match its header (decompression bomb, short data)', () => {
    const small = png({ width: 64, height: 64 });
    const lying = Buffer.from(small);
    lying.writeUInt32BE(1500, 16); // claims 1500 x 64 wide: the data is far too short
    // fix the IHDR checksum so only the data check can catch it
    const ihdrCrc = pngChunk('IHDR', lying.subarray(16, 29)).subarray(-4);
    ihdrCrc.copy(lying, 29);
    expect(reasonOf(lying)).toBe('FORMAT');
  });

  it('refuses huge dimensions before reading anything else', () => {
    const huge = png({ width: 64, height: 64 });
    huge.writeUInt32BE(40000, 16);
    huge.writeUInt32BE(40000, 20);
    pngChunk('IHDR', huge.subarray(16, 29)).subarray(-4).copy(huge, 29);
    expect(reasonOf(huge)).toBe('DIMENSIONS');
    expect(reasonOf(jpeg({ width: 8000, height: 8000 }))).toBe('DIMENSIONS');
    expect(reasonOf(webp({ width: 16000, height: 16000 }))).toBe('DIMENSIONS');
    expect(reasonOf(jpeg({ width: 1600, height: 1000 }), 'LOGO')).toBe('DIMENSIONS');
  });

  it('refuses a file over 300 KB', () => {
    expect(reasonOf(Buffer.concat([png(), Buffer.alloc(MAX_IMAGE_BYTES)]))).toBe('SIZE');
  });

  it('refuses JPEG metadata (EXIF, comments, ICC), bytes after EOI, a missing EOI and CMYK', () => {
    expect(reasonOf(jpeg({ segments: [exifSegment()] }))).toBe('FORMAT');
    expect(reasonOf(jpeg({ trailing: Buffer.from('<?php') }))).toBe('FORMAT');
    expect(reasonOf(jpeg({ trailing: Buffer.from([0xff, 0xd9]) }))).toBe('FORMAT');
    expect(reasonOf(jpeg({ omitEoi: true }))).toBe('FORMAT');
    expect(reasonOf(jpeg({ components: 4 }))).toBe('FORMAT');
    const comment = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x06]), Buffer.from('hack')]);
    expect(reasonOf(jpeg({ segments: [comment] }))).toBe('FORMAT');
    const fakeJfif = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x08]), Buffer.from('NOTJF\0')]);
    expect(reasonOf(jpeg({ segments: [fakeJfif] }))).toBe('FORMAT');
  });

  it('refuses animated, ICC, EXIF and XMP WebP, trailing bytes and a lying RIFF length', () => {
    for (const flags of [0x02, 0x20, 0x08, 0x04])
      expect(reasonOf(webp({ flags })), `flags ${flags}`).toBe('FORMAT');
    expect(reasonOf(webp({ flags: 0x00, extra: riffChunk('ANIM', Buffer.alloc(6)) }))).toBe(
      'FORMAT',
    );
    expect(reasonOf(webp({ flags: 0x00, extra: riffChunk('EXIF', Buffer.from('MM')) }))).toBe(
      'FORMAT',
    );
    expect(reasonOf(webp({ trailing: Buffer.from('<script>') }))).toBe('FORMAT');
    const lying = webp();
    lying.writeUInt32LE(lying.length + 100, 4);
    expect(reasonOf(lying)).toBe('FORMAT');
    expect(reasonOf(webp().subarray(0, 30))).toBe('FORMAT');
  });

  it('refuses a polyglot: a valid PNG start with a second format hidden behind it', () => {
    const polyglot = Buffer.concat([png(), Buffer.from('GIF89a<html>'), PNG_SIGNATURE]);
    expect(reasonOf(polyglot)).toBe('FORMAT');
    expect(reasonOf(Buffer.concat([jpeg(), SVG]))).toBe('FORMAT');
    expect(reasonOf(Buffer.concat([webp(), png()]))).toBe('FORMAT');
  });
});
