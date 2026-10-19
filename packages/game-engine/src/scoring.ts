import { clamp } from '@quizparty/shared';
import type { Outcome, RiskTier, RoundKind, ScoreComponent } from '@quizparty/protocol';
import {
  coverRules,
  cutRules,
  defaultTier,
  maxTotalMultiplierFor,
  type GameConfig,
} from './config';

/**
 * Pure integer scoring (ADR-0007). Every intermediate value is a safe integer; every rounding is a
 * floor; every step is recorded as a component so a score can be reproduced from the audit trail.
 */
export interface ScoreInput {
  roundKind: RoundKind;
  /** Ladder that applies; defaults to the round kind (see `ladderKindFor`). */
  ladderKind?: RoundKind;
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
  /** ADR-0023: Cover was committed (the caller has checked it is allowed). */
  cover?: boolean;
  /** ADR-0023: a CUT is pending on this player; its share of a gain is reported as `cutAmount`. */
  cutPending?: boolean;
  /** False when the player's phone was offline at lock time (no penalty for not answering). */
  connectedAtLock: boolean;
  currentScore: number;
}

export interface ScoreResult {
  outcome: Outcome;
  delta: number;
  components: ScoreComponent[];
  consumedPointTax: boolean;
  /** Points of the gain that go to the CUT's attacker (already subtracted from `delta`). */
  cutAmount: number;
  consumedCut: boolean;
  /** Cover: the fee actually charged, and the loss it waived (0 on a correct answer). */
  coverFee: number;
  coverSaved: number;
}

export function speedBonus(speedMax: number, remainingMs: number, answerMs: number): number {
  if (answerMs <= 0) return 0;
  const remaining = clamp(Math.trunc(remainingMs), 0, answerMs);
  return Math.floor((speedMax * remaining) / answerMs);
}

export function computeScore(input: ScoreInput, config: GameConfig): ScoreResult {
  const { scoring } = config;
  const kind = input.roundKind;
  const ladderKind = input.ladderKind ?? kind;
  const ladder = scoring.ladders[ladderKind];
  const tier =
    input.stake !== undefined && ladder[input.stake]
      ? input.stake
      : defaultTier(config, ladderKind);
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
      // Backstop of "one big gamble per question": no stack of stake and Double Down may pay more
      // than ceiling × (base + speed), whatever the config allows (ADR-0021).
      const ceiling = maxTotalMultiplierFor(config, kind) * (base + speed);
      if (gain > ceiling) {
        components.push({ kind: 'CAP', points: ceiling - gain });
        gain = ceiling;
      }
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
    // CUT comes after the caps: it is a share of what the player really gains (ADR-0023).
    const cut = input.cutPending ? cutRules(config) : null;
    let cutAmount = 0;
    if (cut) {
      cutAmount = Math.min(cut.maxPoints, Math.floor((gain * cut.permille) / 1000));
      if (cutAmount > 0) components.push({ kind: 'CUT', points: -cutAmount });
      gain -= cutAmount;
    }
    // Cover's fee is paid even from a win, never below zero points (ADR-0023).
    let coverFee = 0;
    if (input.cover && rule.loss > 0) {
      const fee = Math.floor((rule.loss * coverRules(config).feePermille) / 1000);
      coverFee = Math.min(fee, Math.max(0, input.currentScore + gain));
      if (fee > 0) components.push({ kind: 'COVER_FEE', points: -fee });
      if (coverFee !== fee) components.push({ kind: 'FLOOR', points: fee - coverFee });
      gain -= coverFee;
    }
    return {
      outcome: 'CORRECT',
      delta: gain,
      components,
      consumedPointTax,
      cutAmount,
      consumedCut: cut !== null,
      coverFee,
      coverSaved: 0,
    };
  }

  // Wrong answer, or no answer while a stake was riding (and the phone was online).
  const atStake = rule.loss > 0 || input.doubleDown;
  const penalised = input.answered || (atStake && input.connectedAtLock);
  const outcome: Outcome = input.answered ? 'INCORRECT' : 'NO_ANSWER';
  const none = { consumedPointTax: false, cutAmount: 0, consumedCut: false };
  if (!penalised) {
    return { outcome, delta: 0, components, ...none, coverFee: 0, coverSaved: 0 };
  }

  const rawLoss = rule.loss + (input.doubleDown ? scoring.doubleDown.extraLoss : 0);
  if (rawLoss === 0) return { outcome, delta: 0, components, ...none, coverFee: 0, coverSaved: 0 };
  if (input.cover && rule.loss > 0) {
    // Covered: the whole loss (stake and any Double Down extra) is waived for the fee.
    const fee = Math.floor((rule.loss * coverRules(config).feePermille) / 1000);
    const charged = Math.min(fee, Math.max(0, input.currentScore));
    if (fee > 0) components.push({ kind: 'COVER_FEE', points: -fee });
    if (charged !== fee) components.push({ kind: 'FLOOR', points: fee - charged });
    return {
      outcome,
      delta: 0 - charged,
      components,
      ...none,
      coverFee: charged,
      coverSaved: rawLoss,
    };
  }
  const applied = Math.min(rawLoss, Math.max(0, input.currentScore));
  components.push({ kind: 'PENALTY', points: -rawLoss });
  if (applied !== rawLoss) components.push({ kind: 'FLOOR', points: rawLoss - applied });
  return { outcome, delta: 0 - applied, components, ...none, coverFee: 0, coverSaved: 0 };
}

/** Sum of components; used by tests to prove `delta` can be reproduced from the audit trail. */
export function sumComponents(components: readonly ScoreComponent[]): number {
  return components.reduce((total, component) => total + component.points, 0);
}
