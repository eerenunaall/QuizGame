import type { Draft } from 'immer';
import type { Rng } from '@quizparty/shared';
import type {
  ClientPayload,
  ErrorCode,
  Joker,
  LadderRung,
  PowerResolutionItem,
  RiskTier,
  RoundKind,
} from '@quizparty/protocol';
import { defaultTier, doubleDownExcludedStakes, ladderKindFor, type GameConfig } from './config';
import type { PowerLedger, PresentedOption, RoomState, RoundState, TargetEffects } from './types';
import { exemptPlayerId } from './who-said-it';

/**
 * Powers, stakes and sabotage (ADR-0007, ADR-0010). Pure helpers over the engine state: the
 * reducer owns phases, events and persistence; the rules live here so they can be tested one by one.
 */
type Room = Draft<RoomState>;

export function newLedger(config: GameConfig): PowerLedger {
  const { powers } = config;
  return {
    fiftyFifty: powers.fiftyFiftyPerGame,
    doubleDown: powers.doubleDownPerGame,
    shield: powers.shieldPerGame,
    tokens: powers.sabotage.enabled ? powers.sabotage.startTokens : 0,
    lastSabotageRound: null,
    hits: 0,
    lastHitRound: null,
    lockout: null,
    pointTax: null,
  };
}

/** Ladder that governs `round`, as rungs players can pick (ADR-0020: mandatory only on the last question). */
export function roundLadder(
  config: GameConfig,
  round: { kind: RoundKind; index: number },
  totalRounds: number,
): { kind: RoundKind; rungs: LadderRung[]; mandatory: boolean; defaultTier: RiskTier } {
  const kind = ladderKindFor(round.kind, round.index === totalRounds - 1);
  const ladder = config.scoring.ladders[kind];
  const rungs: LadderRung[] = [];
  for (const tier of ['SAFE', 'RISK', 'HIGH', 'ALL_IN'] as const) {
    const rule = ladder[tier];
    if (rule) rungs.push({ tier, multiplier: rule.multiplier, loss: rule.loss });
  }
  return {
    kind,
    rungs,
    mandatory: ladder.SAFE === undefined,
    defaultTier: defaultTier(config, kind),
  };
}

export function doubleDownOffered(config: GameConfig): boolean {
  return config.powers.doubleDownPerGame > 0;
}

/** Sabotage is committed in SABOTAGE_PICK of ordinary rounds from `firstRoundIndex` on, never in the final stage. */
export function sabotageOpen(
  config: GameConfig,
  round: Pick<RoundState, 'kind' | 'index'>,
): boolean {
  const cfg = config.powers.sabotage;
  return cfg.enabled && round.kind !== 'FINAL' && round.index >= cfg.firstRoundIndex;
}

export function jokerLockedOut(ledger: PowerLedger, joker: Joker, roundIndex: number): boolean {
  return (
    ledger.lockout !== null && ledger.lockout.round === roundIndex && ledger.lockout.joker === joker
  );
}

/** Streak at which the next sabotage token is earned, or null when none can be earned any more. */
export function nextTokenStreak(config: GameConfig, streak: number): number | null {
  if (!config.powers.sabotage.enabled) return null;
  let next: number | null = null;
  for (const milestone of config.powers.sabotage.earnAtStreaks) {
    if (milestone > streak && (next === null || milestone < next)) next = milestone;
  }
  return next;
}

/** Awards a token when the streak reaches a milestone (agency, not rubber-banding). */
export function earnToken(config: GameConfig, ledger: Draft<PowerLedger>, streak: number): void {
  const cfg = config.powers.sabotage;
  if (cfg.enabled && cfg.earnAtStreaks.includes(streak)) {
    ledger.tokens = Math.min(cfg.maxTokens, ledger.tokens + 1);
  }
}

export type RiskPayload = ClientPayload<'COMMIT_RISK'>;
export type SabotagePayload = ClientPayload<'COMMIT_SABOTAGE'>;

/** Sabotage picks of a round; rounds stored before ADR-0022 have none. */
export const sabotagePicksOf = (round: Pick<RoundState, 'sabotagePicks'>) =>
  round.sabotagePicks ?? {};

/** Whether `playerId` is a seated, active player of the running game. */
function seated(d: Room, playerId: string): boolean {
  const me = d.game?.players[playerId];
  const player = d.players[playerId];
  return !!me && !me.removed && !!player && player.status === 'ACTIVE';
}

/** Another player the sabotage rules would let `attackerId` aim at (the per-hit caps, not this round's picks). */
function hasLegalTarget(d: Room, attackerId: string): boolean {
  const game = d.game!;
  const round = game.round!;
  const cfg = d.config.powers.sabotage;
  return Object.entries(game.players).some(([targetId, target]) => {
    if (targetId === attackerId || !seated(d, targetId)) return false;
    if (target.powers.hits >= cfg.targetMaxPerGame) return false;
    const hitAt = target.powers.lastHitRound;
    return !(hitAt !== null && round.index - hitAt <= cfg.targetMinGapRounds);
  });
}

/**
 * Whether `playerId` could sabotage in this round's SABOTAGE_PICK at all: sabotage is open, a token is
 * held, the attacker cooldown is over and somebody can be targeted (ADR-0022: only such players are
 * waited for; the phase is skipped when nobody qualifies).
 */
export function canSabotage(d: Room, playerId: string): boolean {
  const game = d.game;
  const round = game?.round;
  if (!game || !round || !seated(d, playerId)) return false;
  if (exemptPlayerId(game) === playerId) return false;
  const me = game.players[playerId]!;
  if (!sabotageOpen(d.config, round) || me.powers.tokens <= 0) return false;
  const last = me.powers.lastSabotageRound;
  if (last !== null && round.index - last <= d.config.powers.sabotage.attackerCooldownRounds)
    return false;
  return hasLegalTarget(d, playerId);
}

/** RISK_PICK is shown when somebody can choose something: any stake rung beyond the default, or Double Down. */
export function riskPickOffered(d: Room, eligible: readonly string[]): boolean {
  const game = d.game;
  const round = game?.round;
  if (!game || !round || eligible.length === 0) return false;
  if (roundLadder(d.config, round, game.totalRounds).rungs.length > 1) return true;
  return (
    doubleDownOffered(d.config) &&
    eligible.some((playerId) => (game.players[playerId]?.powers.doubleDown ?? 0) > 0)
  );
}

/** Connected players SABOTAGE_PICK waits for; empty means the phase is skipped. */
export function sabotageActors(d: Room, eligible: readonly string[]): string[] {
  return eligible.filter((playerId) => canSabotage(d, playerId));
}

/**
 * Checks a RISK_PICK commitment (stake + Double Down) against every rule. Returns the first violated
 * rule's error code, or null when valid. Nothing is spent here: the caller applies the commitment
 * only when this returns null (all-or-nothing).
 */
export function checkRisk(d: Room, playerId: string, payload: RiskPayload): ErrorCode | null {
  const game = d.game;
  const round = game?.round;
  if (!game || !round || d.phase !== 'RISK_PICK') return 'INVALID_STATE';
  const me = game.players[playerId];
  if (!seated(d, playerId) || !me) return 'POWER_UNAVAILABLE';
  if (round.commitments[playerId]) return 'ALREADY_COMMITTED';
  // Who Said It: the author of this round's statement has nothing to stake on.
  if (exemptPlayerId(game) === playerId) return 'ANSWER_NOT_ALLOWED';

  const ladder = roundLadder(d.config, round, game.totalRounds);
  if (!ladder.rungs.some((rung) => rung.tier === payload.stake)) return 'STAKE_INVALID';

  if (payload.doubleDown) {
    if (!doubleDownOffered(d.config) || me.powers.doubleDown <= 0) return 'POWER_UNAVAILABLE';
    if (jokerLockedOut(me.powers, 'DOUBLE_DOWN', round.index)) return 'POWER_LOCKED_OUT';
    // One big gamble per question (ADR-0021): checked after availability so the hint matches.
    if (doubleDownExcludedStakes(d.config).includes(payload.stake))
      return 'DOUBLE_DOWN_STAKE_CONFLICT';
  }
  return null;
}

/**
 * Checks a SABOTAGE_PICK commitment. `sabotage: null` (confirm without one) is always legal for a
 * seated player in the phase. Nothing is spent here.
 */
export function checkSabotage(
  d: Room,
  playerId: string,
  payload: SabotagePayload,
): ErrorCode | null {
  const game = d.game;
  const round = game?.round;
  if (!game || !round || d.phase !== 'SABOTAGE_PICK') return 'INVALID_STATE';
  const me = game.players[playerId];
  if (!seated(d, playerId) || !me) return 'POWER_UNAVAILABLE';
  const picks = sabotagePicksOf(round);
  if (picks[playerId]) return 'ALREADY_COMMITTED';
  if (exemptPlayerId(game) === playerId) return 'ANSWER_NOT_ALLOWED';

  const sabotage = payload.sabotage;
  if (sabotage) {
    const cfg = d.config.powers.sabotage;
    if (!sabotageOpen(d.config, round) || me.powers.tokens <= 0) return 'POWER_UNAVAILABLE';
    const target = game.players[sabotage.targetId];
    if (sabotage.targetId === playerId || !target || !seated(d, sabotage.targetId)) {
      return 'TARGET_INVALID';
    }
    const last = me.powers.lastSabotageRound;
    if (last !== null && round.index - last <= cfg.attackerCooldownRounds) return 'SABOTAGE_LIMIT';
    const pending = Object.values(picks).filter((entry) => entry.sabotage !== null);
    if (pending.length >= cfg.maxPerRound) return 'SABOTAGE_LIMIT';
    if (pending.some((entry) => entry.sabotage?.targetId === sabotage.targetId))
      return 'SABOTAGE_LIMIT';
    if (target.powers.hits >= cfg.targetMaxPerGame) return 'SABOTAGE_LIMIT';
    const hitAt = target.powers.lastHitRound;
    if (hitAt !== null && round.index - hitAt <= cfg.targetMinGapRounds) return 'SABOTAGE_LIMIT';
    if (sabotage.effect === 'LOCKOUT') {
      if (!sabotage.joker) return 'POWER_UNAVAILABLE';
      // A lockout already holds this round: another would chain into the next one.
      if (target.powers.lockout?.round === round.index) return 'SABOTAGE_LIMIT';
    }
    if (sabotage.effect === 'POINT_TAX' && target.powers.pointTax !== null) return 'SABOTAGE_LIMIT';
  }
  return null;
}

const shuffledOrder = (ids: readonly string[], rng: Rng): string[] => {
  const order = rng.shuffle([...ids]);
  // A "shuffle" that changes nothing would feel like a bug: rotate by one instead.
  if (order.length > 1 && order.every((id, index) => id === ids[index])) order.push(order.shift()!);
  return order;
};

const emptyEffects = (): TargetEffects => ({
  jamMs: 0,
  order: null,
  fogOptionId: null,
  fogMs: 0,
  hits: [],
});

/**
 * Turns the sabotage committed in SABOTAGE_PICK into effects, once the options exist (SHUFFLE/FOG
 * need them). The shield is checked here: it blocks the first incoming hit and is used up, while the
 * attacker's token stays spent. Players who asked for reduced effects get SHUFFLE and FOG as a
 * half-strength JAM, which looks like any other sabotage to everyone else.
 */
export function resolveSabotage(d: Room, rng: Rng): void {
  const game = d.game!;
  const round = game.round!;
  const cfg = d.config.powers.sabotage;
  const optionIds = round.question!.options.map((option) => option.optionId);
  const joinIndex = (playerId: string): number =>
    d.players[playerId]?.joinIndex ?? Number.MAX_SAFE_INTEGER;
  const attackers = Object.entries(sabotagePicksOf(round))
    .filter(([, pick]) => pick.sabotage !== null)
    .sort(([a, ca], [b, cb]) => ca.committedAt - cb.committedAt || joinIndex(a) - joinIndex(b));

  for (const [actorId, commitment] of attackers) {
    const sabotage = commitment.sabotage!;
    const target = game.players[sabotage.targetId];
    if (!target || target.removed) continue; // the target left: nothing to resolve
    const effects = (round.effects[sabotage.targetId] ??= emptyEffects());
    target.powers.hits += 1;
    target.powers.lastHitRound = round.index;

    if (target.powers.shield > 0) {
      target.powers.shield -= 1;
      effects.hits.push({ effect: sabotage.effect, blocked: true });
      round.sabotages.push({
        actorId,
        targetId: sabotage.targetId,
        effect: sabotage.effect,
        blocked: true,
      });
      continue;
    }
    effects.hits.push({ effect: sabotage.effect, blocked: false });
    round.sabotages.push({
      actorId,
      targetId: sabotage.targetId,
      effect: sabotage.effect,
      blocked: false,
    });

    const jam = Math.min(cfg.jamMs, Math.floor((round.answerMs * cfg.jamMaxPermille) / 1000));
    const softened = d.players[sabotage.targetId]?.reducedEffects === true;
    switch (sabotage.effect) {
      case 'JAM':
        effects.jamMs += jam;
        break;
      case 'SHUFFLE':
        if (softened) effects.jamMs += Math.floor(jam / 2);
        else effects.order = shuffledOrder(optionIds, rng);
        break;
      case 'FOG':
        if (softened) effects.jamMs += Math.floor(jam / 2);
        else {
          effects.fogOptionId = optionIds[rng.int(optionIds.length)] ?? null;
          effects.fogMs = cfg.fogMs;
        }
        break;
      case 'LOCKOUT':
        target.powers.lockout = { joker: sabotage.joker!, round: round.index + 1 };
        break;
      case 'POINT_TAX':
        target.powers.pointTax = { expiresAfterRound: round.index + cfg.pointTaxRounds - 1 };
        break;
    }
  }
}

/** The two options 50/50 leaves: the correct one and one wrong one, in the order they are shown. */
export function chooseFiftyFifty(
  options: readonly PresentedOption[],
  correctOptionId: string,
  rng: Rng,
): string[] {
  const wrong = options.filter((option) => option.optionId !== correctOptionId);
  const kept = wrong[rng.int(wrong.length)];
  return options
    .filter((option) => option.optionId === correctOptionId || option === kept)
    .map((option) => option.optionId);
}

/** Milliseconds cut from `playerId`'s answer window this round (JAM). */
export function jamFor(round: Pick<RoundState, 'effects'>, playerId: string): number {
  return round.effects[playerId]?.jamMs ?? 0;
}

/** Items the POWER_RESOLUTION screen shows: who took a stake, doubled, halved, or sabotaged. */
export function buildPowerItems(d: Room): PowerResolutionItem[] {
  const game = d.game!;
  const round = game.round!;
  const outcome = round.outcome!;
  const ladder = roundLadder(d.config, round, game.totalRounds);
  const players = d.playerOrder.filter((playerId) => outcome.players[playerId] !== undefined);
  const resultOf = (playerId: string) => outcome.players[playerId]!.result;
  const items: PowerResolutionItem[] = [];
  for (const playerId of players) {
    const commitment = round.commitments[playerId];
    if (commitment && commitment.stake !== ladder.defaultTier) {
      items.push({
        kind: 'STAKE',
        playerId,
        tier: commitment.stake,
        outcome: resultOf(playerId),
      });
    }
  }
  for (const playerId of players) {
    if (round.commitments[playerId]?.doubleDown) {
      items.push({ kind: 'DOUBLE_DOWN', playerId, outcome: resultOf(playerId) });
    }
  }
  for (const playerId of players) {
    if (round.fiftyFiftyUsers[playerId]) {
      items.push({ kind: 'FIFTY_FIFTY', playerId, outcome: resultOf(playerId) });
    }
  }
  for (const record of round.sabotages) {
    items.push({
      kind: 'SABOTAGE',
      actorId: record.actorId,
      targetId: record.targetId,
      effect: record.effect,
      blocked: record.blocked,
    });
  }
  return items;
}
