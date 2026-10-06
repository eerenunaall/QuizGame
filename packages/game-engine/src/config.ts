import { z } from 'zod';
import {
  DIFFICULTIES,
  MAX_ROUNDS,
  MIN_ROUNDS,
  RISK_TIERS,
  ROUND_KINDS,
  type DifficultyPreset,
  type RiskTier,
  type RoundKind,
} from '@quizparty/protocol';

/**
 * Everything tunable about a game, as data (GDD §44: live balance changes need no app update).
 * A resolved copy is stored with every game and its `version` is recorded with each score delta so
 * any score can be audited against the rules that produced it (ADR-0007).
 */

const perKind = <T extends z.ZodType>(value: T) =>
  z.strictObject(
    Object.fromEntries(ROUND_KINDS.map((kind) => [kind, value])) as Record<RoundKind, T>,
  );

const LadderRuleSchema = z.strictObject({
  multiplier: z.int().min(1).max(10),
  loss: z.int().min(0).max(5000),
});
export type LadderRule = z.infer<typeof LadderRuleSchema>;
export const LadderSchema = z.partialRecord(z.enum(RISK_TIERS), LadderRuleSchema);
export type Ladder = z.infer<typeof LadderSchema>;

const ms = (min: number, max: number) => z.int().min(min).max(max);

export const GameConfigSchema = z.strictObject({
  version: z.int().positive(),
  maxPlayers: z.int().min(1).max(8),
  minPlayersToStart: z.int().min(1).max(8),
  defaultRounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS),
  /** Hard cap for any room, whatever its tier. */
  maxRounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS),
  freeTier: z.strictObject({ maxRounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS) }),
  /** The final stage is the last `clamp(floor(total / divisor), 1, maxRounds)` questions (ADR-0020). */
  finalStage: z.strictObject({
    divisor: z.int().min(1).max(10),
    maxRounds: z.int().min(1).max(10),
  }),
  timings: z.strictObject({
    countdownMs: ms(0, 10_000),
    roundIntroMs: ms(0, 10_000),
    /** QUESTION_PREP when nothing can be chosen (no stakes, jokers or sabotage on offer). */
    prepMs: ms(0, 30_000),
    /** QUESTION_PREP in ordinary rounds: stakes and powers are offered quietly. */
    prepQuickMs: ms(0, 60_000),
    /** QUESTION_PREP in RISK and FINAL rounds: the ladder is the point of the round. */
    prepDecisionMs: ms(0, 60_000),
    readBaseMs: ms(0, 10_000),
    readPerCharMs: ms(0, 200),
    readMinMs: ms(0, 10_000),
    readMaxMs: ms(0, 20_000),
    answerMs: perKind(ms(1_000, 60_000)),
    lockedMs: ms(0, 5_000),
    revealMs: ms(0, 20_000),
    /** Extra reveal time per character of the explanation, capped by `revealExplanationMaxMs`. */
    revealPerCharMs: ms(0, 200),
    revealExplanationMaxMs: ms(0, 20_000),
    powerResolutionMs: ms(0, 15_000),
    /** Extra POWER_RESOLUTION time for each item after the first, up to `powerResolutionMaxMs`. */
    powerResolutionPerItemMs: ms(0, 5_000),
    powerResolutionMaxMs: ms(0, 30_000),
    scoreUpdateMs: ms(0, 20_000),
    microIntermissionMs: ms(0, 10_000),
    finalIntroMs: ms(0, 15_000),
    /** Extra grace after `answerDeadlineAt` for network latency; 0 = strict (ADR-0006). */
    latencyAllowanceMs: ms(0, 1_000),
    earlyLockGraceMs: ms(0, 30_000),
    displayGraceMs: ms(0, 300_000),
    leaderGraceMs: ms(0, 300_000),
    abandonMs: ms(10_000, 3_600_000),
    lobbyIdleMs: ms(60_000, 86_400_000),
    resultsIdleMs: ms(60_000, 86_400_000),
    maxLifetimeMs: ms(600_000, 172_800_000),
    maxRecoverableOutageMs: ms(0, 7_200_000),
  }),
  scoring: z.strictObject({
    basePoints: perKind(z.int().min(1).max(10_000)),
    speedMax: perKind(z.int().min(0).max(10_000)),
    ladders: perKind(LadderSchema),
    doubleDown: z.strictObject({
      multiplier: z.int().min(1).max(5),
      extraLoss: z.int().min(0).max(5000),
    }),
    fiftyFifty: z.strictObject({
      numerator: z.int().min(1).max(10),
      denominator: z.int().min(1).max(10),
    }),
    pointTax: z.strictObject({ permille: z.int().min(0).max(1000) }),
    maxGainPerQuestion: perKind(z.int().min(1).max(100_000)),
  }),
  powers: z.strictObject({
    fiftyFiftyPerGame: z.int().min(0).max(5),
    doubleDownPerGame: z.int().min(0).max(5),
    shieldPerGame: z.int().min(0).max(3),
    sabotage: z.strictObject({
      enabled: z.boolean(),
      startTokens: z.int().min(0).max(3),
      maxTokens: z.int().min(1).max(5),
      /** A token is earned when the correct-answer streak reaches one of these values. */
      earnAtStreaks: z.array(z.int().min(1).max(30)).max(10),
      /** Zero-based index of the first round in which sabotage may be committed; never in the final stage. */
      firstRoundIndex: z.int().min(0).max(30),
      attackerCooldownRounds: z.int().min(0).max(10),
      maxPerRound: z.int().min(1).max(8),
      /** A target may be hit again only after this many rounds without a hit. */
      targetMinGapRounds: z.int().min(0).max(10),
      targetMaxPerGame: z.int().min(1).max(20),
      jamMs: z.int().min(0).max(10_000),
      /** JAM never takes more than this share of the window (permille). */
      jamMaxPermille: z.int().min(0).max(200),
      fogMs: z.int().min(0).max(10_000),
      /** POINT_TAX lapses after this many rounds if no gain consumed it. */
      pointTaxRounds: z.int().min(1).max(10),
    }),
  }),
  director: z.strictObject({
    startLevel: z.int().min(1000).max(4000),
    /** Lobby difficulty preset → milli-levels added to the start level and to every corridor. */
    presetOffset: z.strictObject({
      EASY: z.int().min(-2000).max(2000),
      MEDIUM: z.int().min(-2000).max(2000),
      HARD: z.int().min(-2000).max(2000),
    }),
    baselineStep: z.int().min(0).max(1000),
    maxStep: z.int().min(0).max(3000),
    windowRounds: z.int().min(1).max(10),
    veryHighPermille: z.int().min(0).max(1000),
    highPermille: z.int().min(0).max(1000),
    lowPermille: z.int().min(0).max(1000),
    veryLowPermille: z.int().min(0).max(1000),
    stepVeryHigh: z.int().min(-2000).max(2000),
    stepHigh: z.int().min(-2000).max(2000),
    stepLow: z.int().min(-2000).max(2000),
    stepVeryLow: z.int().min(-2000).max(2000),
    fastAnswerPermille: z.int().min(0).max(1000),
    fastBonusStep: z.int().min(0).max(1000),
    chaosMax: z.int().min(0).max(20),
    chaosVarianceAt: z.int().min(0).max(20),
    specialBasePermille: z.int().min(0).max(1000),
    specialPerChaosPermille: z.int().min(0).max(1000),
    specialMaxPermille: z.int().min(0).max(1000),
    corridors: z
      .array(z.tuple([z.int().min(1000).max(4000), z.int().min(1000).max(4000)]))
      .min(1)
      .max(12),
    finalCorridor: z.tuple([z.int().min(1000).max(4000), z.int().min(1000).max(4000)]),
    maxSpeedRounds: z.int().min(0).max(5),
    maxCrowdRounds: z.int().min(0).max(5),
    maxRiskRounds: z.int().min(0).max(5),
  }),
});
export type GameConfig = z.infer<typeof GameConfigSchema>;

const STANDARD_LADDER: Ladder = {
  SAFE: { multiplier: 1, loss: 0 },
  RISK: { multiplier: 2, loss: 100 },
  HIGH: { multiplier: 3, loss: 200 },
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: 1,
  maxPlayers: 8,
  minPlayersToStart: 2,
  defaultRounds: 10,
  maxRounds: 20,
  freeTier: { maxRounds: 5 },
  finalStage: { divisor: 3, maxRounds: 5 },
  timings: {
    countdownMs: 3_000,
    roundIntroMs: 2_500,
    prepMs: 2_500,
    prepQuickMs: 6_000,
    prepDecisionMs: 10_000,
    readBaseMs: 1_500,
    readPerCharMs: 25,
    readMinMs: 2_000,
    readMaxMs: 5_000,
    answerMs: { STANDARD: 15_000, SPEED: 8_000, RISK: 15_000, CROWD: 15_000, FINAL: 12_000 },
    lockedMs: 1_000,
    revealMs: 4_500,
    revealPerCharMs: 35,
    revealExplanationMaxMs: 5_000,
    powerResolutionMs: 3_000,
    powerResolutionPerItemMs: 700,
    powerResolutionMaxMs: 8_000,
    scoreUpdateMs: 4_000,
    microIntermissionMs: 1_500,
    finalIntroMs: 4_000,
    latencyAllowanceMs: 0,
    earlyLockGraceMs: 4_000,
    displayGraceMs: 20_000,
    leaderGraceMs: 20_000,
    abandonMs: 600_000,
    lobbyIdleMs: 1_800_000,
    resultsIdleMs: 600_000,
    maxLifetimeMs: 21_600_000,
    maxRecoverableOutageMs: 900_000,
  },
  scoring: {
    basePoints: { STANDARD: 100, SPEED: 100, RISK: 100, CROWD: 100, FINAL: 200 },
    speedMax: { STANDARD: 100, SPEED: 200, RISK: 100, CROWD: 100, FINAL: 200 },
    ladders: {
      STANDARD: STANDARD_LADDER,
      SPEED: STANDARD_LADDER,
      CROWD: STANDARD_LADDER,
      // RISK rounds are symmetric: "wrong: stake lost" (GDD §7.3).
      RISK: {
        SAFE: { multiplier: 1, loss: 0 },
        RISK: { multiplier: 2, loss: 200 },
        HIGH: { multiplier: 3, loss: 300 },
      },
      // The final has no safe lead: a stake is mandatory.
      FINAL: {
        RISK: { multiplier: 2, loss: 150 },
        HIGH: { multiplier: 3, loss: 250 },
        ALL_IN: { multiplier: 5, loss: 400 },
      },
    },
    doubleDown: { multiplier: 2, extraLoss: 100 },
    // Default 1/2: the lifeline halves variance at constant EV. See ADR-0007 for the "2x" contradiction.
    fiftyFifty: { numerator: 1, denominator: 2 },
    pointTax: { permille: 250 },
    maxGainPerQuestion: { STANDARD: 1500, SPEED: 1500, RISK: 1500, CROWD: 1500, FINAL: 2500 },
  },
  powers: {
    fiftyFiftyPerGame: 1,
    doubleDownPerGame: 2,
    shieldPerGame: 1,
    sabotage: {
      enabled: true,
      startTokens: 1,
      maxTokens: 2,
      earnAtStreaks: [3, 6, 9],
      firstRoundIndex: 2,
      attackerCooldownRounds: 2,
      maxPerRound: 2,
      targetMinGapRounds: 2,
      targetMaxPerGame: 3,
      jamMs: 2_000,
      jamMaxPermille: 150,
      fogMs: 1_500,
      pointTaxRounds: 3,
    },
  },
  director: {
    startLevel: 1200,
    presetOffset: { EASY: -400, MEDIUM: 0, HARD: 400 },
    baselineStep: 150,
    maxStep: 450,
    windowRounds: 3,
    veryHighPermille: 900,
    highPermille: 700,
    lowPermille: 400,
    veryLowPermille: 150,
    stepVeryHigh: 350,
    stepHigh: 150,
    stepLow: -150,
    stepVeryLow: -300,
    fastAnswerPermille: 300,
    fastBonusStep: 100,
    chaosMax: 6,
    chaosVarianceAt: 3,
    specialBasePermille: 150,
    specialPerChaosPermille: 40,
    specialMaxPermille: 400,
    corridors: [
      [1000, 1500],
      [1000, 2000],
      [1000, 2200],
      [1500, 2500],
      [1500, 3000],
      [1500, 3200],
      [2000, 3500],
      [2000, 3800],
      [2000, 4000],
    ],
    finalCorridor: [2500, 3800],
    maxSpeedRounds: 2,
    maxCrowdRounds: 2,
    maxRiskRounds: 2,
  },
};

/** Number of questions in the final stage of a game of `totalRounds` questions. */
export function finalStageLength(totalRounds: number, cfg: Pick<GameConfig, 'finalStage'>): number {
  const raw = Math.floor(totalRounds / cfg.finalStage.divisor);
  return Math.max(1, Math.min(cfg.finalStage.maxRounds, raw, totalRounds));
}

/** Highest round count a room may use: the tier limit, never above the hard cap. */
export function maxRoundsFor(config: GameConfig, tier: 'FREE' | 'FULL'): number {
  return tier === 'FREE' ? Math.min(config.freeTier.maxRounds, config.maxRounds) : config.maxRounds;
}

export function presetOffset(config: GameConfig, preset: DifficultyPreset): number {
  return config.director.presetOffset[preset];
}

export function parseGameConfig(input: unknown): GameConfig {
  return GameConfigSchema.parse(input);
}

/** Merges a partial override onto the defaults and validates the result. */
export function resolveGameConfig(override: unknown = {}): GameConfig {
  const merged = deepMerge(structuredCloneJson(DEFAULT_GAME_CONFIG), override);
  return GameConfigSchema.parse(merged);
}

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override))
    return override === undefined ? base : override;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * Which stake ladder governs a round. Every final-stage question pays the final's higher base and
 * speed points, but the mandatory all-or-nothing ladder is reserved for the very last question so a
 * five-question final does not become a coin flip (ADR-0020).
 */
export function ladderKindFor(kind: RoundKind, isLastRound: boolean): RoundKind {
  return kind === 'FINAL' && !isLastRound ? 'STANDARD' : kind;
}

/** Tier that applies when a player has not chosen one: the lowest tier the ladder offers. */
export function defaultTier(config: GameConfig, kind: RoundKind): RiskTier {
  const ladder = config.scoring.ladders[kind];
  for (const tier of RISK_TIERS) if (ladder[tier]) return tier;
  return 'SAFE';
}

export function ladderTiers(config: GameConfig, kind: RoundKind): RiskTier[] {
  const ladder = config.scoring.ladders[kind];
  return RISK_TIERS.filter((tier) => ladder[tier] !== undefined);
}

export { DIFFICULTIES };
