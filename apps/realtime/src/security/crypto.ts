import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Keyed, truncated hash for pseudonymous identifiers (IPs, devices) in logs, limits and the DB. */
export function pseudonym(secret: string, scope: string, value: string): string {
  return createHmac('sha256', secret)
    .update(scope)
    .update('\0')
    .update(value)
    .digest('base64url')
    .slice(0, 22);
}

/** Full keyed digest (hex) for secrets that are compared, never shown: one-time codes, session tokens. */
export function hmacHex(secret: string, scope: string, value: string): string {
  return createHmac('sha256', secret).update(scope).update('\0').update(value).digest('hex');
}
