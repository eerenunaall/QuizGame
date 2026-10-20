import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SealError, Sealer } from './sealer';

const key = (id: string) => ({ id, key: randomBytes(32) });

describe('sealing personal answers', () => {
  it('round-trips and hides the plaintext', () => {
    const sealer = new Sealer([key('k1')]);
    const { sealed, keyId } = sealer.seal('Peugeot 206', 'row|prompt');
    expect(keyId).toBe('k1');
    expect(sealed.toString('utf8')).not.toContain('Peugeot');
    expect(sealer.open(sealed, keyId, 'row|prompt')).toBe('Peugeot 206');
  });

  it('uses a fresh nonce every time (same text seals differently)', () => {
    const sealer = new Sealer([key('k1')]);
    const a = sealer.seal('same', 'aad').sealed;
    const b = sealer.seal('same', 'aad').sealed;
    expect(a.equals(b)).toBe(false);
  });

  it('refuses a value moved to another row, a flipped bit, a truncated value and an unknown key', () => {
    const sealer = new Sealer([key('k1')]);
    const { sealed, keyId } = sealer.seal('secret', 'row-1|prompt-1');
    expect(() => sealer.open(sealed, keyId, 'row-2|prompt-1')).toThrow(SealError);
    const flipped = Buffer.from(sealed);
    flipped[20] = flipped[20]! ^ 1;
    expect(() => sealer.open(flipped, keyId, 'row-1|prompt-1')).toThrow(SealError);
    expect(() => sealer.open(sealed.subarray(0, 20), keyId, 'row-1|prompt-1')).toThrow(SealError);
    expect(() => sealer.open(sealed, 'nope', 'row-1|prompt-1')).toThrow(SealError);
  });

  it('rotates: new values use the first key, old values still open with the older one', () => {
    const old = key('old');
    const fresh = key('new');
    const before = new Sealer([old]).seal('kept', 'aad');
    const after = new Sealer([fresh, old]);
    expect(after.seal('x', 'aad').keyId).toBe('new');
    expect(after.open(before.sealed, before.keyId, 'aad')).toBe('kept');
    expect(() => new Sealer([fresh]).open(before.sealed, before.keyId, 'aad')).toThrow(SealError);
  });

  it('insists on 32-byte keys and at least one key', () => {
    expect(() => new Sealer([])).toThrow();
    expect(() => new Sealer([{ id: 'short', key: randomBytes(16) }])).toThrow();
  });
});
