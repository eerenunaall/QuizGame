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
  /** Double Down cannot be combined with the top stake tiers ("one big gamble per question"). */
  DOUBLE_DOWN_STAKE_CONFLICT: { retryable: false },
  /** Duel (or another big gamble) cannot go with the stake or joker already chosen: one big gamble per question (ADR-0023). */
  BIG_GAMBLE_CONFLICT: { retryable: false },
  /** A Duel limit: none left this game, this rival was already met, or you already hold a duel this question. */
  DUEL_LIMIT: { retryable: false },
  /** Teams (ADR-0026): the team has no free place left. */
  TEAM_FULL: { retryable: false },
  /** Teams: not a team of this room, or the room does not play in teams. */
  TEAM_INVALID: { retryable: false },
  /** Teams: the game cannot start, a team has too many more players than another (the host can move players). */
  TEAMS_UNBALANCED: { retryable: false },
  /** Teams: a game in teams needs at least two teams with players. */
  NOT_ENOUGH_TEAMS: { retryable: false },
  STAKE_INVALID: { retryable: false },
  TARGET_INVALID: { retryable: false },
  /** Sabotage cooldown, per-round, per-target or per-game cap reached. */
  SABOTAGE_LIMIT: { retryable: false },
  ALREADY_COMMITTED: { retryable: false },
  FEATURE_DISABLED: { retryable: false },
  /** The address or device is blocked by a moderator; the reason is never shown to the player. */
  BANNED: { retryable: false },
  /** The store data is not a valid, verified purchase of our product for this app. */
  PURCHASE_INVALID: { retryable: false },
  /** The purchase was made for another account than the one asking. */
  PURCHASE_ACCOUNT_MISMATCH: { retryable: false },
  /** The same store transaction already belongs to a different account. */
  TRANSACTION_ALREADY_BOUND: { retryable: false },
  /** The store has not completed the payment yet (ask to be restored later). */
  PURCHASE_PENDING: { retryable: true },
  /** The store refunded or revoked this purchase. */
  PURCHASE_REFUNDED: { retryable: false },
  /** The store could not be reached to verify; nothing was granted or refused. */
  STORE_UNAVAILABLE: { retryable: true },
  /** Free text was refused (empty, too long, a link, profanity); `params.reason` says which. */
  TEXT_REJECTED: { retryable: false },
  /** A personal answer cannot be stored before the person has agreed to the consent text. */
  CONSENT_REQUIRED: { retryable: false },
  /** An account, quiz or room already holds the most of something it may hold. */
  LIMIT_REACHED: { retryable: false },
  /** The quiz is not ready to be played (not enough approved questions). */
  NOT_READY: { retryable: false },
  /** Venue mode (ADR-0024): the table's paid time is used up or the table was ended; staff can extend it. */
  VENUE_TIME_UP: { retryable: false },
  /** Venue mode: staff paused the table's clock; no new game starts until they resume it. */
  VENUE_PAUSED: { retryable: false },
  /** Venue reward: this code was already used. */
  REWARD_ALREADY_REDEEMED: { retryable: false },
  /** Venue reward: this code's day is over. */
  REWARD_EXPIRED: { retryable: false },
  INTERNAL: { retryable: true },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODE_LIST);

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODES[code].retryable;
}
