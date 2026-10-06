import { clamp } from '@quizparty/shared';
import type { Outcome, RiskTier, RoundKind, ScoreComponent } from '@quizparty/protocol';
import { defaultTier, type GameConfig } from './config';

/**
 * Pure integer scoring (ADR-0007). Every intermediate value is a safe integer; every rounding is a
 * floor; every step is recorded as a component so a score can be reproduced from the audit trail.
 */
export interface ScoreInput {
  roundKind: RoundKind;
  answered: boolean;
  correct: boolean;
  /** Milliseconds left on the clock at acceptance (0..answerMs). Ignored when not answered. */
  remainingMs: number;
  answerMs: number;
  /** Tier committed in QUESTION_PREP, or undefined to use the round's default tier. */
  stake: RiskTier | undefined;
  doubleDown: boolean;
  fiftyFifty: boolean;
  pointTaxPending: boolean;
  /** False when the player's phone was offline at lock time (no penalty for not answering). */
  connectedAtLock: boolean;
  currentScore: number;
}

export interface ScoreResult {
  outcome: Outcome;
  delta: number;
  components: ScoreComponent[];
  consumedPointTax: boolean;
}

export function speedBonus(speedMax: number, remainingMs: number, answerMs: number): number {
  if (answerMs <= 0) return 0;
  const remaining = clamp(Math.trunc(remainingMs), 0, answerMs);
  return Math.floor((speedMax * remaining) / answerMs);
}

export function computeScore(input: ScoreInput, config: GameConfig): ScoreResult {
  const { scoring } = config;
  const kind = input.roundKind;
  const ladder = scoring.ladders[kind];
  const tier =
    input.stake !== undefined && ladder[input.stake] ? input.stake : defaultTier(config, kind);
  const rule = ladder[tier] ?? { multiplier: 1, loss: 0 };
  const components: ScoreComponent[] = [];

  if (input.answered && input.correct) {
    const base = scoring.basePoints[kind];
    const stakeGain = base * rule.multiplier;
    const speed = speedBonus(scoring.speedMax[kind], input.remainingMs, input.answerMs);
    let gain = stakeGain + speed;
    components.push({ kind: 'BASE', points: base });
    if (stakeGain !== base) components.push({ kind: 'STAKE', points: stakeGain - base });
    if (speed !== 0) components.push({ kind: 'SPEED', points: speed });

    if (input.doubleDown) {
      const doubled = gain * scoring.doubleDown.multiplier;
      components.push({ kind: 'DOUBLE_DOWN', points: doubled - gain });
      gain = doubled;
    }
    if (input.fiftyFifty) {
      const reduced = Math.floor(
        (gain * scoring.fiftyFifty.numerator) / scoring.fiftyFifty.denominator,
      );
      if (reduced !== gain) components.push({ kind: 'FIFTY_FIFTY', points: reduced - gain });
      gain = reduced;
    }
    let consumedPointTax = false;
    if (input.pointTaxPending) {
      const tax = Math.floor((gain * scoring.pointTax.permille) / 1000);
      if (tax > 0) components.push({ kind: 'POINT_TAX', points: -tax });
      gain -= tax;
      consumedPointTax = true;
    }
    const cap = scoring.maxGainPerQuestion[kind];
    if (gain > cap) {
      components.push({ kind: 'CAP', points: cap - gain });
      gain = cap;
    }
    return { outcome: 'CORRECT', delta: gain, components, consumedPointTax };
  }

  // Wrong answer, or no answer while a stake was riding (and the phone was online).
  const atStake = rule.loss > 0 || input.doubleDown;
  const penalised = input.answered || (atStake && input.connectedAtLock);
  const outcome: Outcome = input.answered ? 'INCORRECT' : 'NO_ANSWER';
  if (!penalised) return { outcome, delta: 0, components, consumedPointTax: false };

  const rawLoss = rule.loss + (input.doubleDown ? scoring.doubleDown.extraLoss : 0);
  if (rawLoss === 0) return { outcome, delta: 0, components, consumedPointTax: false };
  const applied = Math.min(rawLoss, Math.max(0, input.currentScore));
  components.push({ kind: 'PENALTY', points: -rawLoss });
  if (applied !== rawLoss) components.push({ kind: 'FLOOR', points: rawLoss - applied });
  return { outcome, delta: 0 - applied, components, consumedPointTax: false };
}

/** Sum of components; used by tests to prove `delta` can be reproduced from the audit trail. */
export function sumComponents(components: readonly ScoreComponent[]): number {
  return components.reduce((total, component) => total + component.points, 0);
}
