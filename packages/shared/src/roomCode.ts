import { secureRandomInt } from './random';

/** 31 symbols: no 0/O/1/I/L so codes survive being read aloud from a TV (GDD §18). */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_REGEX = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export function generateRoomCode(
  randomInt: (maxExclusive: number) => number = secureRandomInt,
): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]!;
  }
  return code;
}

/**
 * Accepts what a person might type or paste ("abc 234", "ABC-234"), returns the canonical code or
 * `null`. Locale-independent upper-casing on purpose: Turkish dotless ı must not become İ.
 */
export function parseRoomCode(input: string): string | null {
  if (input.length > 32) return null;
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  return ROOM_CODE_REGEX.test(compact) ? compact : null;
}
