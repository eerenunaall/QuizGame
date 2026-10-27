/** Wire protocol version (ADR-0008). Bump on breaking changes; the server supports a range. */
export const PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

/** Hard limits applied before any schema parsing (DoS protection). */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
export const MAX_NICKNAME_LENGTH = 16;
export const MIN_NICKNAME_LENGTH = 2;
export const MAX_PLAYERS_LIMIT = 8;
/** Who Said It (ADR-0015): one short statement per player, collected in the lobby. */
export const MAX_STATEMENT_LENGTH = 140;
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 20;

/** How a room plays (ADR-0026): everyone for themselves, or in teams the host chose the number of. */
export const PLAY_MODES = ['INDIVIDUAL', 'TEAMS'] as const;
export type PlayMode = (typeof PLAY_MODES)[number];

/** Which powers are in the game: the whole menu, or the café set (ADR-0026 §3). */
export const RULESETS = ['FULL', 'SIMPLE'] as const;
export type Ruleset = (typeof RULESETS)[number];

/**
 * Team slots (ADR-0026). Fixed by us, never typed by players: the slot fixes the icon (an avatar id, so
 * the existing artwork is the badge), the colour (`--qp-color-player-<slot>`) and the default name
 * (`team.<id>` in the i18n catalog). A venue may rename a slot (`LobbySettings.teamNames`), nothing else.
 */
export const TEAM_IDS = [
  'tiger',
  'owl',
  'fox',
  'lion',
  'bear',
  'dragon',
  'whale',
  'penguin',
] as const;
export type TeamId = (typeof TEAM_IDS)[number];
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const MAX_TEAM_NAME_LENGTH = 20;

/** 1-based colour slot of a team (its position in `TEAM_IDS`). */
export const teamColorSlot = (teamId: TeamId): number => TEAM_IDS.indexOf(teamId) + 1;

export const PHASES = [
  'WAITING',
  'LOBBY',
  'COUNTDOWN',
  'ROUND_INTRO',
  /** Legacy (ADR-0022): replaced by RISK_PICK + SABOTAGE_PICK. Never entered; kept so old data parses. */
  'QUESTION_PREP',
  /** Stakes, Double Down and the other jokers, on their own timed screen (ADR-0022). */
  'RISK_PICK',
  /** Sabotage commits, on their own timed screen after RISK_PICK (ADR-0022). */
  'SABOTAGE_PICK',
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

/** Lobby difficulty presets: they shift the director's band, they never pick questions per player. */
export const DIFFICULTY_PRESETS = ['EASY', 'MEDIUM', 'HARD'] as const;
export type DifficultyPreset = (typeof DIFFICULTY_PRESETS)[number];

export const ROUND_KINDS = ['STANDARD', 'SPEED', 'RISK', 'CROWD', 'FINAL'] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

export const RISK_TIERS = ['SAFE', 'RISK', 'HIGH', 'ALL_IN'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** Limited-use lifelines (ADR-0007). */
export const JOKERS = ['FIFTY_FIFTY', 'DOUBLE_DOWN'] as const;
export type Joker = (typeof JOKERS)[number];

/**
 * The sabotage subset (ADR-0010). NOISE is deliberately absent. STAKE_CAP, CUT and BLIND_CLOCK were
 * added by ADR-0023 (each can be switched off in the game config).
 */
export const SABOTAGE_KINDS = [
  'JAM',
  'SHUFFLE',
  'FOG',
  'LOCKOUT',
  'POINT_TAX',
  'STAKE_CAP',
  'CUT',
  'BLIND_CLOCK',
] as const;
export type SabotageKind = (typeof SABOTAGE_KINDS)[number];

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

/** Fixed avatar set; the web and mobile clients draw these, the server only accepts these ids. */
export const AVATAR_IDS = [
  'fox',
  'panda',
  'owl',
  'cat',
  'dog',
  'rabbit',
  'tiger',
  'koala',
  'penguin',
  'frog',
  'lion',
  'monkey',
  'bear',
  'unicorn',
  'dragon',
  'robot',
  'octopus',
  'alien',
  'ghost',
  'cool',
  'nerd',
  'cowboy',
  'chick',
  'whale',
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/**
 * Why a player reports a question from the reveal screen (GDD §10). The same list is the database
 * constraint on `question_reports.reason`; a test keeps them equal. Reports carry no free text:
 * nothing a player types ever reaches a moderator unchecked.
 */
export const QUESTION_REPORT_REASONS = [
  'WRONG_ANSWER',
  'MULTIPLE_CORRECT',
  'OUTDATED',
  'TYPO',
  'OFFENSIVE',
  'UNCLEAR',
  'DUPLICATE',
  'OTHER',
] as const;
export type QuestionReportReason = (typeof QUESTION_REPORT_REASONS)[number];
