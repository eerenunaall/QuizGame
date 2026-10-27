import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url';

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('base64url', () => {
  it('matches known vectors', () => {
    expect(encodeBase64Url(new Uint8Array())).toBe('');
    expect(encodeBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8');
    expect(encodeBase64Url(ascii('Man'))).toBe('TWFu');
    expect(encodeBase64Url(ascii('Ma'))).toBe('TWE');
    expect(encodeBase64Url(ascii('M'))).toBe('TQ');
  });

  it('round-trips arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100 }), (bytes) => {
        expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
      }),
    );
  });

  it('matches the platform base64 implementation', () => {
    const reference = (bytes: Uint8Array): string =>
      (globalThis as unknown as { btoa(data: string): string })
        .btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(encodeBase64Url(bytes)).toBe(reference(bytes));
      }),
    );
  });

  it('rejects padding, foreign characters and non-canonical encodings', () => {
    for (const bad of ['TQ==', 'T Q', 'TQ+', 'T', 'TR', 'ü'])
      expect(decodeBase64Url(bad)).toBeNull();
  });
});
