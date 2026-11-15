import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SealingKey {
  id: string;
  key: Buffer;
}

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealError';
  }
}

const NONCE = 12;
const TAG = 16;

/**
 * AES-256-GCM sealing for personal answers (ADR-0015). A fresh random nonce per seal, the key id
 * stored beside the ciphertext so keys can rotate, and the additional authenticated data binds a
 * ciphertext to its row: moving a sealed value to another response makes it unreadable.
 */
export class Sealer {
  private readonly keys: Map<string, Buffer>;
  private readonly active: SealingKey;

  constructor(keys: readonly SealingKey[]) {
    const [active] = keys;
    if (!active) throw new Error('no sealing key configured');
    for (const { key } of keys) if (key.length !== 32) throw new Error('sealing keys are 32 bytes');
    this.active = active;
    this.keys = new Map(keys.map((k) => [k.id, k.key]));
  }

  seal(plaintext: string, aad: string): { sealed: Buffer; keyId: string } {
    const nonce = randomBytes(NONCE);
    const cipher = createCipheriv('aes-256-gcm', this.active.key, nonce);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { sealed: Buffer.concat([nonce, body, cipher.getAuthTag()]), keyId: this.active.id };
  }

  open(sealed: Buffer, keyId: string, aad: string): string {
    const key = this.keys.get(keyId);
    if (!key) throw new SealError('unknown key id');
    if (sealed.length < NONCE + TAG) throw new SealError('sealed value too short');
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
    try {
      return Buffer.concat([
        decipher.update(sealed.subarray(NONCE, sealed.length - TAG)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SealError('sealed value does not verify');
    }
  }
}
