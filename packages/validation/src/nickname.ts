import { containsProfanity } from './profanity';
import { validateNicknameShape, type NicknameResult } from './nickname-core';

export {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  validateNicknameShape,
  type NicknameRejection,
  type NicknameResult,
} from './nickname-core';

/**
 * Validates and normalizes a player nickname (ADR-0009). Returns the cleaned display name and a
 * folded `key` used for per-room uniqueness. Rejects control/format/bidi/zero-width characters,
 * mixed scripts (homoglyph attacks), reserved names and profanity.
 */
export function validateNickname(raw: unknown): NicknameResult {
  return validateNicknameShape(raw, (normalized) =>
    containsProfanity(normalized, { strict: true }) ? 'PROFANITY' : null,
  );
}
