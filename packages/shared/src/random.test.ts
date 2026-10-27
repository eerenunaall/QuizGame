import { describe, expect, it } from 'vitest';
import { decodeBase64Url } from './base64url';
import { randomToken, randomUuid, secureRandomBytes, secureRandomInt } from './random';

describe('secure random helpers', () => {
  it('secureRandomInt stays within range and rejects bad bounds', () => {
    for (let i = 0; i < 500; i++) {
      const v = secureRandomInt(31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(31);
    }
    expect(secureRandomInt(1)).toBe(0);
    expect(() => secureRandomInt(0)).toThrow(RangeError);
    expect(() => secureRandomInt(Number.NaN)).toThrow(RangeError);
  });

  it('randomToken encodes 256 bits by default and never repeats', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(decodeBase64Url(a)).toHaveLength(32);
    expect(a).toHaveLength(43);
  });

  it('supports sizes larger than the 64 KiB getRandomValues limit', () => {
    const bytes = secureRandomBytes(70_000);
    expect(bytes).toHaveLength(70_000);
    expect(new Set(bytes).size).toBeGreaterThan(200);
  });

  it('randomUuid returns a v4 UUID', () => {
    expect(randomUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
