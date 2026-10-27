import { z } from 'zod';
import {
  AvatarIdSchema,
  CategoryIdSchema,
  CloseReasonSchema,
  ConnectionSchema,
  DifficultyPresetSchema,
  DifficultySchema,
  EpochMsSchema,
  JokerSchema,
  LocaleSchema,
  OptionIdSchema,
  PhaseSchema,
  PlayerIdSchema,
  PlayModeSchema,
  QuestionIdSchema,
  RiskTierSchema,
  RoundKindSchema,
  RulesetSchema,
  SabotageKindSchema,
  TeamIdSchema,
  TierSchema,
  UuidSchema,
} from './common';
import {
  MAX_ROUNDS,
  MAX_STATEMENT_LENGTH,
  MAX_TEAMS,
  MAX_TEAM_NAME_LENGTH,
  MIN_ROUNDS,
  MIN_TEAMS,
  TEAM_IDS,
} from './constants';

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
  /** Team play (ADR-0026): the team this player is in; absent in individual play. */
  teamId: TeamIdSchema.optional(),
});
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;

export const LobbySettingsSchema = z.strictObject({
  mode: z.enum(['CLASSIC', 'BLIND', 'CUSTOM', 'WHO_SAID_IT']),
  /** Name of the personal quiz in use (shown on the lobby screens); null for the classic game. */
  contentTitle: z.string().max(60).nullable(),
  rounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS),
  difficulty: DifficultyPresetSchema,
  categories: z.union([z.literal('ALL'), z.array(CategoryIdSchema).min(1).max(24)]),
  /**
   * ADR-0026, all optional so snapshots and clients from before them still parse: absent = individual
   * play, full ruleset, two teams, default names.
   */
  play: PlayModeSchema.optional(),
  ruleset: RulesetSchema.optional(),
  teamCount: z.int().min(MIN_TEAMS).max(MAX_TEAMS).optional(),
  /** A venue's own names for the team slots, in `TEAM_IDS` order; an empty string keeps the default name. */
  teamNames: z.array(z.string().max(MAX_TEAM_NAME_LENGTH)).max(TEAM_IDS.length).optional(),
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

/**
 * One team's standing (ADR-0026 §4). Teams are ranked by `average` (points per active member), `total`
 * is shown beside it; members who left no longer count in either.
 */
export const TeamStandingSchema = z.strictObject({
  teamId: TeamIdSchema,
  rank: z.int().positive(),
  total: z.int().nonnegative(),
  average: z.int().nonnegative(),
  members: z.int().positive(),
  correctCount: z.int().nonnegative(),
});
export type TeamStanding = z.infer<typeof TeamStandingSchema>;

export const PublicOptionSchema = z.strictObject({
  optionId: OptionIdSchema,
  text: z.string().max(240),
  /** Who Said It: the option is this player (the TV draws their avatar). Every player is an option, so it says nothing about the author. */
  playerId: PlayerIdSchema.optional(),
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
    /** ADR-0023: the Cover fee, the net of a Pot, a Duel transfer and a Cut (paid or received). */
    'COVER_FEE',
    'POT',
    'DUEL',
    'CUT',
  ]),
  points: z.int(),
});
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

/** One rung of the stake ladder as the phone and TV show it. */
export const LadderRungSchema = z.strictObject({
  tier: RiskTierSchema,
  multiplier: z.int().positive(),
  /** Points lost on a wrong (or missing) answer at this tier. */
  loss: z.int().nonnegative(),
  /** What Cover costs at this tier, when it is on offer (ADR-0023); absent from older servers. */
  coverFee: z.int().nonnegative().optional(),
});
export type LadderRung = z.infer<typeof LadderRungSchema>;

/**
 * What the POWER_RESOLUTION screen shows after the reveal. Outcomes are already public by then (the
 * reveal named them); they let the TV say "went HIGH and was right" without replaying the round.
 */
export const PowerResolutionItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('STAKE'),
    playerId: PlayerIdSchema,
    tier: RiskTierSchema,
    outcome: OutcomeSchema,
  }),
  z.strictObject({
    kind: z.literal('DOUBLE_DOWN'),
    playerId: PlayerIdSchema,
    outcome: OutcomeSchema,
  }),
  z.strictObject({
    kind: z.literal('FIFTY_FIFTY'),
    playerId: PlayerIdSchema,
    outcome: OutcomeSchema,
  }),
  z.strictObject({
    kind: z.literal('SABOTAGE'),
    actorId: PlayerIdSchema,
    /** Individual play: the player hit. Team play: `targetTeamId` instead (ADR-0026). */
    targetId: PlayerIdSchema.optional(),
    targetTeamId: TeamIdSchema.optional(),
    effect: SabotageKindSchema,
    blocked: z.boolean(),
  }),
  /** ADR-0023: Cover paid its fee (`saved` = the loss it waived, 0 when the answer was right). */
  z.strictObject({
    kind: z.literal('COVER'),
    playerId: PlayerIdSchema,
    outcome: OutcomeSchema,
    fee: z.int().nonnegative(),
    saved: z.int().nonnegative(),
  }),
  /** ADR-0023: the pot of the question. `refunded` = it did not run (too few players or nobody right). */
  z.strictObject({
    kind: z.literal('POT'),
    playerIds: z.array(PlayerIdSchema).max(8),
    winnerIds: z.array(PlayerIdSchema).max(8),
    size: z.int().nonnegative(),
    refunded: z.boolean(),
  }),
  /** ADR-0023: a Duel that was challenged. `accepted: false` = declined or never answered. */
  z.strictObject({
    kind: z.literal('DUEL'),
    challengerId: PlayerIdSchema,
    rivalId: PlayerIdSchema,
    accepted: z.boolean(),
    winnerId: PlayerIdSchema.nullable(),
    points: z.int().nonnegative(),
  }),
  /** ADR-0023: a Cut paid out (the target's gain went to the attacker). */
  z.strictObject({
    kind: z.literal('CUT'),
    actorId: PlayerIdSchema,
    targetId: PlayerIdSchema,
    points: z.int().nonnegative(),
  }),
]);
export type PowerResolutionItem = z.infer<typeof PowerResolutionItemSchema>;

const round = RoundPublicSchema;

/**
 * The extra choices RISK_PICK offers beyond stake and Double Down (ADR-0023). Config-derived and the
 * same for everybody, so it is public; `null`/`false` = switched off for this venue or round.
 */
export const RisksOfferedSchema = z.strictObject({
  cover: z.boolean(),
  /** Duel: points moved when only one side is right / when both are right and one is faster. */
  duel: z.strictObject({ win: z.int().nonnegative(), bothRight: z.int().nonnegative() }).nullable(),
  /** Pot: the ante, and how many players must be in the room for it to run. */
  pot: z.strictObject({ ante: z.int().positive(), minPlayers: z.int().positive() }).nullable(),
});
export type RisksOffered = z.infer<typeof RisksOfferedSchema>;
const answeredIds = z.array(PlayerIdSchema).max(8);

export const PhaseDataSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('WAITING') }),
  z.strictObject({
    phase: z.literal('LOBBY'),
    /** Who Said It only: who has handed in a statement (never the words). */
    statementPlayerIds: z.array(PlayerIdSchema).max(8).optional(),
  }),
  z.strictObject({ phase: z.literal('COUNTDOWN') }),
  z.strictObject({ phase: z.literal('ROUND_INTRO'), round }),
  /** Legacy (ADR-0022): never emitted any more, kept so stored snapshots and old clients parse. */
  z.strictObject({
    phase: z.literal('QUESTION_PREP'),
    round,
    category: CategoryRefSchema,
    difficulty: DifficultySchema,
    riskLadder: z.array(LadderRungSchema).min(1).max(4),
    /** True when the ladder has no SAFE rung (the last question): a stake must be taken. */
    stakeMandatory: z.boolean(),
    doubleDownEnabled: z.boolean(),
    /** Stakes that cannot be combined with Double Down; absent from older servers (ADR-0021). */
    doubleDownExcludedStakes: z.array(RiskTierSchema).max(4).optional(),
    sabotageEnabled: z.boolean(),
    /** What else RISK_PICK offers (ADR-0023); absent from older servers = nothing else. */
    risks: RisksOfferedSchema.optional(),
    /** Players who have made their choices / players who are expected to. */
    committedCount: z.int().nonnegative(),
    eligibleCount: z.int().nonnegative(),
  }),
  z.strictObject({
    phase: z.literal('RISK_PICK'),
    round,
    category: CategoryRefSchema,
    difficulty: DifficultySchema,
    riskLadder: z.array(LadderRungSchema).min(1).max(4),
    /** True when the ladder has no SAFE rung (the last question): a stake must be taken. */
    stakeMandatory: z.boolean(),
    doubleDownEnabled: z.boolean(),
    /** Stakes that cannot be combined with Double Down; absent from older servers (ADR-0021). */
    doubleDownExcludedStakes: z.array(RiskTierSchema).max(4).optional(),
    sabotageEnabled: z.boolean(),
    /** What else RISK_PICK offers (ADR-0023); absent from older servers = nothing else. */
    risks: RisksOfferedSchema.optional(),
    /**
     * The simple ruleset's single prep phase (ADR-0026 §3): Double Down and the sabotage are chosen here
     * and there is no SABOTAGE_PICK. `offered` is the sabotage menu, the same for everybody.
     */
    combined: z.boolean().optional(),
    offered: z.array(SabotageKindSchema).max(12).optional(),
    /** Players who have made their choices / players who are expected to. */
    committedCount: z.int().nonnegative(),
    eligibleCount: z.int().nonnegative(),
  }),
  z.strictObject({
    phase: z.literal('SABOTAGE_PICK'),
    round,
    category: CategoryRefSchema,
    difficulty: DifficultySchema,
    /**
     * The menu: sabotages switched on and legal this round, in display order (config, the same for
     * everybody; ADR-0023). Absent from older servers = the five original ones. Never anybody's pick.
     */
    offered: z.array(SabotageKindSchema).max(12).optional(),
    /** Cut's share and ceiling, present when Cut is on the menu (for its one-line rule). */
    cutRule: z
      .strictObject({ permille: z.int().nonnegative(), maxPoints: z.int().nonnegative() })
      .optional(),
    /**
     * Players who confirmed / players at the table. Counts only, never who (ATTACK 27): the number of
     * players who could sabotage is not disclosed either, so this is out of everybody online.
     */
    committedCount: z.int().nonnegative(),
    eligibleCount: z.int().nonnegative(),
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
    /** Team play (ADR-0026): the team standings after this question. */
    teamBoard: z.array(TeamStandingSchema).max(MAX_TEAMS).optional(),
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
    /** Team play (ADR-0026): the final team standings; `ranking` stays the individual list. */
    teamRanking: z.array(TeamStandingSchema).max(MAX_TEAMS).optional(),
  }),
  z.strictObject({ phase: z.literal('ROOM_CLOSED'), reason: CloseReasonSchema }),
]);
export type PhaseData = z.infer<typeof PhaseDataSchema>;
export type PhaseDataOf<P extends PhaseData['phase']> = Extract<PhaseData, { phase: P }>;

/** Remaining lifelines and tokens, private to their owner. */
export const PowersViewSchema = z.strictObject({
  fiftyFifty: z.int().nonnegative(),
  doubleDown: z.int().nonnegative(),
  shield: z.int().nonnegative(),
  sabotageTokens: z.int().nonnegative(),
  /** Correct-answer streak that earns the next sabotage token (null when none can be earned). */
  nextTokenAtStreak: z.int().positive().nullable(),
  /** Joker that a lockout blocks this round, else null. */
  lockedJoker: JokerSchema.nullable(),
  /** ADR-0023: Cover / Duel / Pot uses left this game; absent from older servers. */
  cover: z.int().nonnegative().optional(),
  duel: z.int().nonnegative().optional(),
  pot: z.int().nonnegative().optional(),
  /** ADR-0023: STAKE_CAP on this player this round: the highest stake they may take; else null/absent. */
  stakeCap: RiskTierSchema.nullable().optional(),
});
export type PowersView = z.infer<typeof PowersViewSchema>;

/** What the player committed this round (private until POWER_RESOLUTION). */
export const CommitmentViewSchema = z.strictObject({
  stake: RiskTierSchema,
  doubleDown: z.boolean(),
  sabotage: z
    .strictObject({
      targetId: PlayerIdSchema.optional(),
      targetTeamId: TeamIdSchema.optional(),
      effect: SabotageKindSchema,
    })
    .nullable(),
  /** ADR-0023 extras; present only when chosen. */
  cover: z.boolean().optional(),
  pot: z.boolean().optional(),
  duel: z.strictObject({ targetId: PlayerIdSchema }).optional(),
});
export type CommitmentView = z.infer<typeof CommitmentViewSchema>;

/** A sabotage that landed (or was blocked by the shield) on this player: never names the attacker. */
export const HitViewSchema = z.strictObject({ effect: SabotageKindSchema, blocked: z.boolean() });
export type HitView = z.infer<typeof HitViewSchema>;

/** Presentation effects on this player's phone for the current question. */
export const EffectsViewSchema = z.strictObject({
  /** Milliseconds cut from this player's answer window (JAM, or half-strength when softened). */
  jamMs: z.int().nonnegative(),
  /** Option ids in the order this player's phone lists them (SHUFFLE), else null. */
  order: z.array(OptionIdSchema).max(8).nullable(),
  /** Option that stays hidden for the first `fogMs` of the window (FOG), else null. */
  fogOptionId: OptionIdSchema.nullable(),
  fogMs: z.int().nonnegative(),
  /** BLIND_CLOCK (ADR-0023): hide this phone's countdown for the question (the TV's clock stays). */
  blindClock: z.boolean().optional(),
});
export type EffectsView = z.infer<typeof EffectsViewSchema>;

export const YouViewSchema = z.strictObject({
  playerId: PlayerIdSchema,
  isLeader: z.boolean(),
  canHost: z.boolean(),
  /** Team play (ADR-0026): this player's team. */
  teamId: TeamIdSchema.optional(),
  answer: z
    .strictObject({
      questionId: QuestionIdSchema,
      optionId: OptionIdSchema,
      lockedAt: EpochMsSchema,
    })
    .nullable(),
  /** Null outside a running game. */
  powers: PowersViewSchema.nullable(),
  commitment: CommitmentViewSchema.nullable(),
  /**
   * SABOTAGE_PICK (ADR-0022): this player can sabotage right now (token, cooldown, a legal target), and
   * whether they already confirmed. Private to this player; absent from older servers.
   */
  sabotage: z.strictObject({ ready: z.boolean(), decided: z.boolean() }).optional(),
  /**
   * Duel challenges aimed at this player this round (ADR-0023), private to them. `answer` is their own
   * reply (null = not yet). Absent when nobody challenged them.
   */
  duelInvites: z
    .array(
      z.strictObject({
        challengerId: PlayerIdSchema,
        answer: z.enum(['ACCEPTED', 'DECLINED']).nullable(),
      }),
    )
    .max(8)
    .optional(),
  /** The two options that remain after this player used 50/50 on the current question. */
  fiftyFifty: z.strictObject({ keep: z.array(OptionIdSchema).max(8) }).nullable(),
  effects: EffectsViewSchema.nullable(),
  hits: z.array(HitViewSchema).max(8),
  reducedEffects: z.boolean(),
  /** Who Said It: this player's own statement (lobby), so they can edit it; null for everyone else's. */
  myStatement: z.string().max(MAX_STATEMENT_LENGTH).nullable(),
  /** Who Said It: the current round's statement is this player's, so they sit it out. Only that player is told. */
  authorOfRound: z.boolean(),
});
export type YouView = z.infer<typeof YouViewSchema>;

export const PublicGameSchema = z.strictObject({
  gameId: UuidSchema,
  totalRounds: z.int().positive(),
  roundIndex: z.int().min(-1),
  scoreboard: z.array(ScoreboardEntrySchema).max(8),
  /** Team play (ADR-0026): the team standings as of the last scored question. */
  teamBoard: z.array(TeamStandingSchema).max(MAX_TEAMS).optional(),
});

/**
 * Venue mode (ADR-0024): the table's time meter, the only venue data a room frame ever carries.
 * `endsAt` is server time while RUNNING; `remainingMs` is what is left at the frame's server time.
 */
export const VenueMeterViewSchema = z.strictObject({
  state: z.enum(['RUNNING', 'PAUSED', 'ENDED']),
  endsAt: EpochMsSchema.nullable(),
  remainingMs: z.int().nonnegative(),
});
export type VenueMeterView = z.infer<typeof VenueMeterViewSchema>;

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
  /** Venue mode only (ADR-0024); absent for every other room and from older servers. */
  venue: VenueMeterViewSchema.optional(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;
