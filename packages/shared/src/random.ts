import { encodeBase64Url } from './base64url';

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?: () => string;
}

function webCrypto(): CryptoLike {
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random source is not available in this runtime');
  }
  return c;
}

export function secureRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  // getRandomValues is limited to 65536 bytes per call.
  for (let offset = 0; offset < length; offset += 65536) {
    webCrypto().getRandomValues(out.subarray(offset, Math.min(offset + 65536, length)));
  }
  return out;
}

/** Uniform integer in `[0, maxExclusive)` via rejection sampling (no modulo bias). */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) {
    throw new RangeError('maxExclusive must be an integer in [1, 2^32]');
  }
  if (maxExclusive === 1) return 0;
  const limit = 0x100000000 - (0x100000000 % maxExclusive);
  const buffer = new Uint32Array(1);
  for (;;) {
    webCrypto().getRandomValues(buffer);
    const value = buffer[0]!;
    if (value < limit) return value % maxExclusive;
  }
}

/** Unguessable opaque token (default 256 bits) encoded as unpadded base64url. */
export function randomToken(bytes = 32): string {
  return encodeBase64Url(secureRandomBytes(bytes));
}

/** RFC 4122 version-4 UUID. */
export function randomUuid(): string {
  const c = webCrypto();
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = secureRandomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
