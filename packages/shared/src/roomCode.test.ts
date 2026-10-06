import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, ROOM_CODE_REGEX, generateRoomCode, parseRoomCode } from './roomCode';

describe('room codes', () => {
  it('alphabet has no ambiguous characters', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L']) expect(ROOM_CODE_ALPHABET).not.toContain(bad);
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
  });

  it('generates well-formed, varied codes', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateRoomCode()));
    for (const code of codes) expect(code).toMatch(ROOM_CODE_REGEX);
    expect(codes.size).toBeGreaterThan(495);
  });

  it('parses pasted or typed variants', () => {
    expect(parseRoomCode('abc 234')).toBe('ABC234');
    expect(parseRoomCode('ABC-234')).toBe('ABC234');
    expect(parseRoomCode('  x7p4kq\n')).toBe('X7P4KQ');
  });

  it('rejects invalid input, including look-alikes and injection attempts', () => {
    for (const bad of [
      '',
      'ABC12',
      'ABC1234',
      'ABCIO0',
      'AB<script>',
      '../../etc',
      'ABC234\u0000',
      'a'.repeat(500),
      'ıııııı', // dotless i must not be folded into a valid symbol
    ]) {
      expect(parseRoomCode(bad)).toBeNull();
    }
  });
});
