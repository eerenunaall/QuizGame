import { z } from 'zod';

/**
 * Quiz Gecesi domain types (ADR-0029). The engine is pure: time and actor are injected by the caller,
 * the state is a fold over an append-only command log, so a replay always yields the same night.
 */

export const ROUND_KINDS = [
  'NORMAL',
  'PICTURE',
  'MUSIC',
  'TRUE_FALSE',
  'ESTIMATE',
  'BONUS',
] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

const Text = (max: number) => z.string().max(max);

export const AnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('TEXT'), text: Text(300) }),
  z.strictObject({ type: z.literal('OPTION'), index: z.int().min(0).max(5) }),
  z.strictObject({
    type: z.literal('NUMBER'),
    value: z.number().finite(),
    unit: Text(20).optional(),
  }),
  z.strictObject({ type: z.literal('BOOL'), value: z.boolean() }),
]);
export type Answer = z.infer<typeof AnswerSchema>;

export const QuestionDefSchema = z.strictObject({
  id: z.string().min(1).max(64),
  /** Set when the question was picked from the venue pool / global bank (ADR-0025); informational. */
  sourceQuestionId: z.string().max(64).optional(),
  text: Text(600),
  options: z.array(Text(200)).min(2).max(6).optional(),
  imageUrl: Text(500).optional(),
  answer: AnswerSchema,
  explanation: Text(600).optional(),
  points: z.int().min(0).max(100),
  jokerAllowed: z.boolean(),
});
export type QuestionDef = z.infer<typeof QuestionDefSchema>;

export const RoundDefSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: z.enum(ROUND_KINDS),
  title: Text(80),
  questions: z.array(QuestionDefSchema).max(40),
});
export type RoundDef = z.infer<typeof RoundDefSchema>;

export const TeamDefSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: Text(40).min(1),
  badge: z.strictObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), emoji: Text(8) }),
  /** Table number; the paper rotation follows the table order. */
  table: z.int().min(1).max(999),
});
export type TeamDef = z.infer<typeof TeamDefSchema>;

export const SettingsSchema = z.strictObject({
  jokersPerTeam: z.int().min(0).max(10),
  wrongDoublePenalty: z.boolean(),
  timerSec: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  /** Show the half-time slide after this many rounds (0 = none). */
  halfTimeAfterRound: z.int().min(0).max(20),
  entranceText: Text(120),
  prizeText: Text(160),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const ConfigSchema = z.strictObject({
  title: Text(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rounds: z.array(RoundDefSchema).max(12),
  tieBreak: QuestionDefSchema.nullable(),
  teams: z.array(TeamDefSchema).max(40),
  settings: SettingsSchema,
});
export type QuizConfig = z.infer<typeof ConfigSchema>;

export const TIE_QUESTION_ID = 'tie-break';

// ---- commands (what the tablet may send; the server stamps seq/at/actor itself) ----------------------

const Id = z.string().min(1).max(64);
export const CommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('START') }),
  z.strictObject({ type: z.literal('NEXT') }),
  z.strictObject({ type: z.literal('BACK') }),
  z.strictObject({ type: z.literal('PAUSE') }),
  z.strictObject({ type: z.literal('RESUME') }),
  z.strictObject({ type: z.literal('TIMER_START'), seconds: z.int().min(5).max(600) }),
  z.strictObject({ type: z.literal('JOKER'), questionId: Id, teamId: Id, on: z.boolean() }),
  z.strictObject({ type: z.literal('MARK'), questionId: Id, teamId: Id, right: z.boolean() }),
  z.strictObject({
    type: z.literal('MARK_COUNT'),
    roundId: Id,
    teamId: Id,
    count: z.int().min(0).max(40),
  }),
  z.strictObject({ type: z.literal('MARKING_MODE'), roundId: Id, mode: z.enum(['GRID', 'COUNT']) }),
  z.strictObject({
    type: z.literal('ESTIMATE_VALUE'),
    questionId: Id,
    teamId: Id,
    value: z.number().finite().nullable(),
  }),
  z.strictObject({ type: z.literal('MARKER'), teamId: Id, markerTeamId: Id }),
  z.strictObject({ type: z.literal('SHOW_STANDINGS') }),
  z.strictObject({ type: z.literal('HIDE_OVERLAY') }),
  z.strictObject({ type: z.literal('CLOSE') }),
]);
export type Command = z.infer<typeof CommandSchema>;

export interface LogEvent {
  seq: number;
  at: number;
  actor: string;
  cmd: Command;
  /** Value before this command changed it (corrections); null when nothing was replaced. Set by the engine. */
  prev: unknown;
}

export type QError =
  | 'NOT_STARTED'
  | 'ALREADY_STARTED'
  | 'CLOSED'
  | 'AT_END'
  | 'AT_START'
  | 'UNKNOWN_REF'
  | 'JOKER_LOCKED'
  | 'JOKER_NOT_ALLOWED'
  | 'JOKER_LIMIT'
  | 'MARK_NOT_OPEN'
  | 'MODE_CONFLICT'
  | 'COUNT_UNAVAILABLE'
  | 'COUNT_TOO_HIGH'
  | 'NOT_ESTIMATE'
  | 'NO_TIMER_HERE'
  | 'NOT_PAUSED'
  | 'BAD_MARKER'
  | 'PODIUM_NOT_REACHED'
  | 'INVALID_CONFIG'
  | 'NOOP';

export interface Timer {
  seconds: number;
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
}

export interface QState {
  config: QuizConfig;
  started: boolean;
  closed: boolean;
  /** Index into the step script; -1 before START. */
  cursor: number;
  /** Cursors we came from, for BACK. */
  trail: number[];
  /** Highest cursor ever shown on the TV: jokers and scoring locks key off this, so BACK cannot unlock. */
  reached: number;
  paused: boolean;
  overlay: 'STANDINGS' | null;
  timer: Timer | null;
  jokers: Record<string, string[]>;
  marks: Record<string, Record<string, boolean>>;
  counts: Record<string, Record<string, number>>;
  modes: Record<string, 'GRID' | 'COUNT'>;
  estimates: Record<string, Record<string, number>>;
  markers: Record<string, string>;
  seq: number;
}

export type StepKind =
  | 'INTRO'
  | 'HOWTO'
  | 'ROUND_TITLE'
  | 'QUESTION'
  | 'LOCKED'
  | 'SWAP'
  | 'ANSWER'
  | 'MARKING'
  | 'ROUND_SCORES'
  | 'STANDINGS'
  | 'HALF_TIME'
  | 'TIE_QUESTION'
  | 'TIE_ANSWER'
  | 'PODIUM';

export interface Step {
  kind: StepKind;
  /** Round index (0-based) when the step belongs to a round. */
  round?: number;
  /** Question index inside the round. */
  q?: number;
}
