import { clamp, type Rng } from '@quizparty/shared';
import { DIFFICULTIES, type Difficulty, type RoundKind } from '@quizparty/protocol';
import type { GameConfig } from './config';

/**
 * Game Director (ADR-0011): a pure, deterministic pacing function.
 *
 * Its input type contains only room-level aggregates. There is deliberately no player identifier,
 * score, rank or nickname anywhere in it, so "give the leader a hard question" is not expressible.
 * Levels are integer milli-levels: 1000 = EASY … 4000 = EXPERT.
 */
export const LEVEL_MIN = 1000;
export const LEVEL_MAX = 4000;

export function levelToBucket(level: number): Difficulty {
  if (level < 1500) return 'EASY';
  if (level < 2500) return 'MEDIUM';
  if (level < 3500) return 'HARD';
  return 'EXPERT';
}

export function bucketIndex(bucket: Difficulty): number {
  return DIFFICULTIES.indexOf(bucket);
}

export interface DirectorInput {
  roundIndex: number;
  totalRounds: number;
  /** Level used for the previous round (the configured start level for round 0). */
  level: number;
  /** Share of eligible players who answered correctly, per completed round, oldest → newest (permille). */
  recentCorrectPermille: readonly number[];
  /** Mean share of the answer window used by those who answered, per completed round (permille). */
  recentAvgAnswerPermille: readonly number[];
  /** Share of players who took a stake above the lowest tier, per completed round (permille). */
  recentRiskTakePermille: readonly number[];
  chaos: number;
}

export interface DirectorOutput {
  level: number;
  bucket: Difficulty;
  /** 1 lets selection stray one bucket (inside the corridor) for surprise; 0 keeps it exact. */
  varianceBuckets: 0 | 1;
  specialEventPermille: number;
  riskIntensity: 0 | 1 | 2 | 3;
  chaos: number;
  corridor: readonly [number, number];
}

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : Math.floor(values.reduce((sum, value) => sum + value, 0) / values.length);

export function corridorFor(
  cfg: GameConfig['director'],
  roundIndex: number,
  totalRounds: number,
): readonly [number, number] {
  const isFinal = roundIndex >= totalRounds - 1;
  if (isFinal) return cfg.finalCorridor;
  const nonFinal = totalRounds - 1;
  const last = cfg.corridors.length - 1;
  const index = nonFinal <= 1 ? 0 : Math.round((roundIndex * last) / (nonFinal - 1));
  return cfg.corridors[clamp(index, 0, last)]!;
}

export function direct(input: DirectorInput, cfg: GameConfig['director']): DirectorOutput {
  const isFinal = input.roundIndex >= input.totalRounds - 1;
  const correct = input.recentCorrectPermille.slice(-cfg.windowRounds);

  let adjust = 0;
  if (correct.length > 0) {
    const average = mean(correct);
    if (average >= cfg.veryHighPermille) adjust = cfg.stepVeryHigh;
    else if (average >= cfg.highPermille) adjust = cfg.stepHigh;
    else if (average >= cfg.lowPermille) adjust = 0;
    else if (average >= cfg.veryLowPermille) adjust = cfg.stepLow;
    else adjust = cfg.stepVeryLow;
    const speed = input.recentAvgAnswerPermille.slice(-cfg.windowRounds);
    if (average >= cfg.highPermille && speed.length > 0 && mean(speed) <= cfg.fastAnswerPermille) {
      adjust += cfg.fastBonusStep;
    }
  }

  const baseline = input.roundIndex === 0 ? 0 : cfg.baselineStep;
  const step = clamp(baseline + adjust, -cfg.maxStep, cfg.maxStep);
  const corridor = corridorFor(cfg, input.roundIndex, input.totalRounds);
  const level = clamp(input.level + step, corridor[0], corridor[1]);

  let chaos = input.chaos;
  const latest = input.recentCorrectPermille.at(-1);
  if (latest !== undefined) {
    if (latest < cfg.veryLowPermille) chaos += 1;
    else if (latest >= cfg.lowPermille) chaos -= 1;
  }
  chaos = clamp(chaos, 0, cfg.chaosMax);

  const varianceBuckets: 0 | 1 =
    chaos >= cfg.chaosVarianceAt && mean(correct) < cfg.veryHighPermille ? 1 : 0;
  const specialEventPermille =
    isFinal || input.roundIndex < 2
      ? 0
      : clamp(
          cfg.specialBasePermille + chaos * cfg.specialPerChaosPermille,
          0,
          cfg.specialMaxPermille,
        );

  const riskTaken = input.recentRiskTakePermille.slice(-cfg.windowRounds);
  const timid = input.roundIndex >= 3 && riskTaken.length > 0 && mean(riskTaken) < 200 ? 1 : 0;
  const riskIntensity = clamp(
    (input.roundIndex >= 3 ? 1 : 0) + Math.floor(chaos / 2) + timid,
    0,
    isFinal ? 3 : 2,
  ) as 0 | 1 | 2 | 3;

  return {
    level,
    bucket: levelToBucket(level),
    varianceBuckets,
    specialEventPermille,
    riskIntensity: isFinal ? 3 : riskIntensity,
    chaos,
    corridor,
  };
}

export interface RoundKindInput {
  roundIndex: number;
  totalRounds: number;
  history: readonly RoundKind[];
  specialEventPermille: number;
  riskIntensity: number;
}

/**
 * Picks the kind of the coming round. Hard constraints (never violated, whatever the dice say):
 * FINAL is last, nothing special in rounds 1–2, no two specials in a row, per-kind caps, and a RISK
 * round before the final in games long enough to host one.
 */
export function chooseRoundKind(
  input: RoundKindInput,
  cfg: GameConfig['director'],
  rng: Rng,
): RoundKind {
  if (input.roundIndex >= input.totalRounds - 1) return 'FINAL';
  const count = (kind: RoundKind): number => input.history.filter((entry) => entry === kind).length;
  const previous = input.history.at(-1);
  const nonFinalLeft = input.totalRounds - 1 - input.roundIndex; // includes this round

  const riskAllowed = count('RISK') < cfg.maxRiskRounds;
  if (
    riskAllowed &&
    count('RISK') === 0 &&
    nonFinalLeft <= 1 &&
    input.totalRounds >= 4 &&
    previous === 'STANDARD'
  ) {
    return 'RISK';
  }
  if (input.roundIndex < 2 || (previous !== undefined && previous !== 'STANDARD'))
    return 'STANDARD';
  if (!rng.chance(input.specialEventPermille)) return 'STANDARD';

  const options: { kind: RoundKind; weight: number }[] = [];
  if (count('SPEED') < cfg.maxSpeedRounds) options.push({ kind: 'SPEED', weight: 3 });
  if (count('CROWD') < cfg.maxCrowdRounds) options.push({ kind: 'CROWD', weight: 3 });
  if (riskAllowed) options.push({ kind: 'RISK', weight: 2 + input.riskIntensity * 2 });
  if (options.length === 0) return 'STANDARD';
  return options[rng.weightedIndex(options.map((option) => option.weight))]!.kind;
}
