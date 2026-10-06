/** Wire protocol version (ADR-0008). Bump on breaking changes; the server supports a range. */
export const PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

/** Hard limits applied before any schema parsing (DoS protection). */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
export const MAX_NICKNAME_LENGTH = 16;
export const MIN_NICKNAME_LENGTH = 2;
export const MAX_PLAYERS_LIMIT = 8;

export const PHASES = [
  'WAITING',
  'LOBBY',
  'COUNTDOWN',
  'ROUND_INTRO',
  'QUESTION_PREP',
  'QUESTION',
  'ANSWERING',
  'LOCKED',
  'REVEAL',
  'POWER_RESOLUTION',
  'SCORE_UPDATE',
  'MICRO_INTERMISSION',
  'NEXT_ROUND',
  'FINAL',
  'RESULTS',
  'ROOM_CLOSED',
] as const;
export type Phase = (typeof PHASES)[number];

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ROUND_KINDS = ['STANDARD', 'SPEED', 'RISK', 'CROWD', 'FINAL'] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

export const RISK_TIERS = ['SAFE', 'RISK', 'HIGH', 'ALL_IN'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const CLOSE_REASONS = [
  'HOST_ENDED',
  'IDLE',
  'LIFETIME',
  'ABANDONED',
  'INTERRUPTED',
  'FINISHED',
  'ADMIN',
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const LOCALES = ['tr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const TIERS = ['FREE', 'FULL'] as const;
export type Tier = (typeof TIERS)[number];
