import { z } from 'zod';
import {
  AvatarIdSchema,
  CategoryIdSchema,
  CloseReasonSchema,
  ConnectionSchema,
  DifficultyPresetSchema,
  DifficultySchema,
  EpochMsSchema,
  LocaleSchema,
  OptionIdSchema,
  PhaseSchema,
  PlayerIdSchema,
  QuestionIdSchema,
  RiskTierSchema,
  RoundKindSchema,
  TierSchema,
  UuidSchema,
} from './common';
import { MAX_ROUNDS, MIN_ROUNDS } from './constants';

/**
 * Views are what clients may see. Every schema is `strictObject`: the server builds views from
 * allow-lists and validates outbound traffic against these schemas, so a field that is not listed
 * here cannot leak by accident (ADR-0008).
 */

export const PublicPlayerSchema = z.strictObject({
  playerId: PlayerIdSchema,
  nickname: z.string().max(64),
  avatarId: AvatarIdSchema,
  colorSlot: z.int().min(1).max(8),
  joinIndex: z.int().nonnegative(),
  connection: ConnectionSchema,
  ready: z.boolean(),
  isLeader: z.boolean(),
});
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;

export const LobbySettingsSchema = z.strictObject({
  mode: z.enum(['CLASSIC']),
  rounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS),
  difficulty: DifficultyPresetSchema,
  categories: z.union([z.literal('ALL'), z.array(CategoryIdSchema).min(1).max(24)]),
});
export type LobbySettings = z.infer<typeof LobbySettingsSchema>;

export const RoundPublicSchema = z.strictObject({
  index: z.int().nonnegative(),
  total: z.int().positive(),
  kind: RoundKindSchema,
  isFinal: z.boolean(),
  /** Position inside the final stage (1-based) and its length; null outside the final stage. */
  finalStage: z
    .strictObject({ position: z.int().positive(), length: z.int().positive() })
    .nullable(),
  basePoints: z.int().positive(),
  speedMax: z.int().nonnegative(),
  answerMs: z.int().positive(),
});
export type RoundPublic = z.infer<typeof RoundPublicSchema>;

export const CategoryRefSchema = z.strictObject({
  id: CategoryIdSchema,
  label: z.string().max(80),
});

export const ScoreboardEntrySchema = z.strictObject({
  playerId: PlayerIdSchema,
  score: z.int().nonnegative(),
  rank: z.int().positive(),
  streak: z.int().nonnegative(),
});
export type ScoreboardEntry = z.infer<typeof ScoreboardEntrySchema>;

export const PublicOptionSchema = z.strictObject({
  optionId: OptionIdSchema,
  text: z.string().max(240),
});
export type PublicOption = z.infer<typeof PublicOptionSchema>;

export const OutcomeSchema = z.enum(['CORRECT', 'INCORRECT', 'NO_ANSWER']);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const ScoreComponentSchema = z.strictObject({
  kind: z.enum([
    'BASE',
    'STAKE',
    'SPEED',
    'DOUBLE_DOWN',
    'FIFTY_FIFTY',
    'POINT_TAX',
    'CAP',
    'PENALTY',
    'FLOOR',
  ]),
  points: z.int(),
});
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

export const SABOTAGE_KINDS = ['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX'] as const;
export const SabotageKindSchema = z.enum(SABOTAGE_KINDS);
export type SabotageKind = z.infer<typeof SabotageKindSchema>;

export const PowerResolutionItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('STAKE'), playerId: PlayerIdSchema, tier: RiskTierSchema }),
  z.strictObject({ kind: z.literal('DOUBLE_DOWN'), playerId: PlayerIdSchema }),
  z.strictObject({ kind: z.literal('FIFTY_FIFTY'), playerId: PlayerIdSchema }),
  z.strictObject({
    kind: z.literal('SABOTAGE'),
    actorId: PlayerIdSchema,
    targetId: PlayerIdSchema,
    effect: SabotageKindSchema,
    blocked: z.boolean(),
  }),
]);
export type PowerResolutionItem = z.infer<typeof PowerResolutionItemSchema>;

const round = RoundPublicSchema;
const answeredIds = z.array(PlayerIdSchema).max(8);

export const PhaseDataSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('WAITING') }),
  z.strictObject({ phase: z.literal('LOBBY') }),
  z.strictObject({ phase: z.literal('COUNTDOWN') }),
  z.strictObject({ phase: z.literal('ROUND_INTRO'), round }),
  z.strictObject({
    phase: z.literal('QUESTION_PREP'),
    round,
    category: CategoryRefSchema,
    difficulty: DifficultySchema,
    riskLadder: z.array(RiskTierSchema).max(4),
    doubleDownEnabled: z.boolean(),
    sabotageEnabled: z.boolean(),
    committedCount: z.int().nonnegative(),
  }),
  z.strictObject({
    phase: z.literal('QUESTION'),
    round,
    questionId: QuestionIdSchema,
    text: z.string().max(600),
    category: CategoryRefSchema,
    difficulty: DifficultySchema,
  }),
  z.strictObject({
    phase: z.literal('ANSWERING'),
    round,
    questionId: QuestionIdSchema,
    text: z.string().max(600),
    options: z.array(PublicOptionSchema).min(2).max(8),
    category: CategoryRefSchema,
    difficulty: DifficultySchema,
    questionStartedAt: EpochMsSchema,
    answerOpensAt: EpochMsSchema,
    answerDeadlineAt: EpochMsSchema,
    answeredPlayerIds: answeredIds,
  }),
  z.strictObject({
    phase: z.literal('LOCKED'),
    round,
    questionId: QuestionIdSchema,
    answeredPlayerIds: answeredIds,
  }),
  z.strictObject({
    phase: z.literal('REVEAL'),
    round,
    questionId: QuestionIdSchema,
    text: z.string().max(600),
    options: z.array(PublicOptionSchema).min(2).max(8),
    correctOptionId: OptionIdSchema,
    explanation: z.string().max(600).nullable(),
    distribution: z.array(
      z.strictObject({ optionId: OptionIdSchema, count: z.int().nonnegative() }),
    ),
    results: z.array(
      z.strictObject({
        playerId: PlayerIdSchema,
        outcome: OutcomeSchema,
        optionId: OptionIdSchema.nullable(),
      }),
    ),
  }),
  z.strictObject({
    phase: z.literal('POWER_RESOLUTION'),
    round,
    items: z.array(PowerResolutionItemSchema).max(64),
  }),
  z.strictObject({
    phase: z.literal('SCORE_UPDATE'),
    round,
    deltas: z.array(
      z.strictObject({
        playerId: PlayerIdSchema,
        delta: z.int(),
        total: z.int().nonnegative(),
        rank: z.int().positive(),
        previousRank: z.int().positive(),
        components: z.array(ScoreComponentSchema).max(12),
      }),
    ),
    scoreboard: z.array(ScoreboardEntrySchema).max(8),
  }),
  z.strictObject({
    phase: z.literal('MICRO_INTERMISSION'),
    next: z.strictObject({ index: z.int().nonnegative(), kind: RoundKindSchema }).nullable(),
  }),
  z.strictObject({
    phase: z.literal('FINAL'),
    round,
  }),
  z.strictObject({
    phase: z.literal('RESULTS'),
    ranking: z
      .array(
        z.strictObject({
          playerId: PlayerIdSchema,
          score: z.int().nonnegative(),
          rank: z.int().positive(),
          correctCount: z.int().nonnegative(),
          bestStreak: z.int().nonnegative(),
        }),
      )
      .max(8),
    awards: z
      .array(
        z.strictObject({
          kind: z.enum(['SHARPSHOOTER', 'FASTEST_FINGER', 'STREAK_MASTER', 'COMEBACK']),
          playerId: PlayerIdSchema,
        }),
      )
      .max(8),
  }),
  z.strictObject({ phase: z.literal('ROOM_CLOSED'), reason: CloseReasonSchema }),
]);
export type PhaseData = z.infer<typeof PhaseDataSchema>;
export type PhaseDataOf<P extends PhaseData['phase']> = Extract<PhaseData, { phase: P }>;

export const YouViewSchema = z.strictObject({
  playerId: PlayerIdSchema,
  isLeader: z.boolean(),
  canHost: z.boolean(),
  answer: z
    .strictObject({
      questionId: QuestionIdSchema,
      optionId: OptionIdSchema,
      lockedAt: EpochMsSchema,
    })
    .nullable(),
});
export type YouView = z.infer<typeof YouViewSchema>;

export const PublicGameSchema = z.strictObject({
  gameId: UuidSchema,
  totalRounds: z.int().positive(),
  roundIndex: z.int().min(-1),
  scoreboard: z.array(ScoreboardEntrySchema).max(8),
});

export const RoomViewSchema = z.strictObject({
  roomId: UuidSchema,
  code: z.string().min(6).max(6),
  stateVersion: z.int().nonnegative(),
  serverTime: EpochMsSchema,
  phase: PhaseSchema,
  phaseEnteredAt: EpochMsSchema,
  phaseDeadlineAt: EpochMsSchema.nullable(),
  tier: TierSchema,
  contentLanguage: LocaleSchema,
  maxPlayers: z.int().min(1).max(8),
  /** What the current tier allows, so the lobby can lock options instead of hiding them. */
  limits: z.strictObject({ maxRounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS) }),
  settings: LobbySettingsSchema,
  displayConnected: z.boolean(),
  awaitingDisplay: z.boolean(),
  players: z.array(PublicPlayerSchema).max(8),
  game: PublicGameSchema.nullable(),
  phaseData: PhaseDataSchema,
  you: YouViewSchema.nullable(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;
