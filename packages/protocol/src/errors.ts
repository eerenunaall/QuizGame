import { z } from 'zod';

/**
 * Machine-readable error codes. The protocol never carries prose: clients localize
 * (ADR-0016). `retryable` tells clients whether repeating the same request can succeed.
 */
export const ERROR_CODES = {
  INVALID_MESSAGE: { retryable: false },
  UNSUPPORTED_PROTOCOL: { retryable: false },
  RATE_LIMITED: { retryable: true },
  UNAUTHORIZED: { retryable: false },
  FORBIDDEN: { retryable: false },
  ROOM_NOT_FOUND: { retryable: false },
  ROOM_FULL: { retryable: false },
  ROOM_CLOSED: { retryable: false },
  GAME_IN_PROGRESS: { retryable: false },
  NICKNAME_TAKEN: { retryable: false },
  NICKNAME_INVALID: { retryable: false },
  ALREADY_JOINED: { retryable: false },
  SESSION_EXPIRED: { retryable: false },
  SESSION_REVOKED: { retryable: false },
  STALE_SEQUENCE: { retryable: false },
  INVALID_STATE: { retryable: false },
  NOT_HOST: { retryable: false },
  NOT_ENOUGH_PLAYERS: { retryable: false },
  TIER_REQUIRED: { retryable: false },
  NOT_ENOUGH_QUESTIONS: { retryable: false },
  QUESTION_MISMATCH: { retryable: false },
  OPTION_INVALID: { retryable: false },
  ANSWER_LATE: { retryable: false },
  ANSWER_DUPLICATE: { retryable: false },
  ANSWER_NOT_ALLOWED: { retryable: false },
  PLAYER_NOT_FOUND: { retryable: false },
  /** A power that is used up, not offered this round, or outside its window. */
  POWER_UNAVAILABLE: { retryable: false },
  /** A sabotage "lockout" from another player blocks that joker this round. */
  POWER_LOCKED_OUT: { retryable: false },
  STAKE_INVALID: { retryable: false },
  TARGET_INVALID: { retryable: false },
  /** Sabotage cooldown, per-round, per-target or per-game cap reached. */
  SABOTAGE_LIMIT: { retryable: false },
  ALREADY_COMMITTED: { retryable: false },
  FEATURE_DISABLED: { retryable: false },
  INTERNAL: { retryable: true },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODE_LIST);

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODES[code].retryable;
}
