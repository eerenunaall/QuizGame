import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET } from '@quizparty/shared';

/**
 * Pairing codes for venue displays (ADR-0028 §2): 8 symbols of the room-code alphabet (no 0/O, 1/I/L),
 * i.e. 31^8 ≈ 8.5e11 values (39.6 bits). Shown as `XXXX-XXXX`; typed in any case, with or without the dash.
 */
export const PAIRING_CODE_LENGTH = 8;

export function newPairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++)
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** What the owner typed as a canonical code, or null when it cannot be one (never reaches the database). */
export function parsePairingCode(input: string): string | null {
  const code = input.toLocaleUpperCase('en-US').replace(/[\s-]/gu, '');
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  for (const char of code) if (!ROOM_CODE_ALPHABET.includes(char)) return null;
  return code;
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
