import type {
  Joker,
  PhaseDataOf,
  PublicOption,
  PublicPlayer,
  RiskTier,
  SabotageKind,
  YouView,
} from '@quizparty/protocol';
import type { StickerId } from '../lib/assets';

/** What the phone sends for QUESTION_PREP: everything decided at once, final once sent. */
export interface PrepChoice {
  stake: RiskTier;
  doubleDown: boolean;
  sabotage: { targetId: string; effect: SabotageKind; joker?: Joker } | null;
}

export const SABOTAGE_ORDER: readonly SabotageKind[] = [
  'JAM',
  'SHUFFLE',
  'FOG',
  'LOCKOUT',
  'POINT_TAX',
];
export const JOKER_ORDER: readonly Joker[] = ['FIFTY_FIFTY', 'DOUBLE_DOWN'];

export const SABOTAGE_STICKER: Record<SabotageKind, StickerId> = {
  JAM: 'stopwatch',
  SHUFFLE: 'shuffle',
  FOG: 'fog',
  LOCKOUT: 'lock',
  POINT_TAX: 'coin',
};

export const STAKE_STICKER: Record<RiskTier, StickerId> = {
  SAFE: 'shield',
  RISK: 'bolt',
  HIGH: 'hot-face',
  ALL_IN: 'rocket',
};

export const JOKER_STICKER: Record<Joker, StickerId> = {
  FIFTY_FIFTY: 'light-bulb',
  DOUBLE_DOWN: 'fire',
};

type PrepData = PhaseDataOf<'QUESTION_PREP'>;

/** The tier that applies when the player does not choose: the lowest rung of the ladder. */
export function defaultStake(data: PrepData): RiskTier {
  return data.riskLadder[0]?.tier ?? 'SAFE';
}

export type Unavailable = 'NONE_LEFT' | 'LOCKED' | 'CLOSED' | 'NO_TOKEN' | null;

export function doubleDownState(data: PrepData, you: YouView | null): Unavailable {
  if (!data.doubleDownEnabled || !you?.powers) return 'CLOSED';
  if (you.powers.lockedJoker === 'DOUBLE_DOWN') return 'LOCKED';
  return you.powers.doubleDown > 0 ? null : 'NONE_LEFT';
}

export function sabotageState(data: PrepData, you: YouView | null): Unavailable {
  if (!data.sabotageEnabled || !you?.powers) return 'CLOSED';
  return you.powers.sabotageTokens > 0 ? null : 'NO_TOKEN';
}

export function fiftyFiftyState(you: YouView | null): Unavailable {
  if (!you?.powers) return 'CLOSED';
  if (you.powers.lockedJoker === 'FIFTY_FIFTY') return 'LOCKED';
  return you.powers.fiftyFifty > 0 ? null : 'NONE_LEFT';
}

/** Players this player may aim at: everyone else who is in the room. */
export function sabotageTargets(players: readonly PublicPlayer[], myId: string): PublicPlayer[] {
  return players.filter((player) => player.playerId !== myId);
}

/** Options in the order this phone lists them: a SHUFFLE order wins; unknown ids are ignored. */
export function orderedOptions(
  options: readonly PublicOption[],
  order: readonly string[] | null | undefined,
): PublicOption[] {
  if (!order) return [...options];
  const byId = new Map(options.map((option) => [option.optionId, option]));
  const listed = order.flatMap((id) => {
    const option = byId.get(id);
    return option ? [option] : [];
  });
  const missing = options.filter((option) => !order.includes(option.optionId));
  return [...listed, ...missing];
}

/** After 50/50 only the kept options can be picked. */
export function isRemoved(optionId: string, keep: readonly string[] | undefined): boolean {
  return keep !== undefined && !keep.includes(optionId);
}

/** FOG hides one option's text until `fogMs` after the window opened. */
export function isFogged(
  optionId: string,
  effects: YouView['effects'],
  openedAt: number,
  nowMs: number,
): boolean {
  return (
    effects !== null &&
    effects.fogOptionId === optionId &&
    effects.fogMs > 0 &&
    nowMs < openedAt + effects.fogMs
  );
}

/** The window this player actually has: JAM shortens their own clock. */
export function personalDeadline(deadlineAt: number, effects: YouView['effects']): number {
  return deadlineAt - (effects?.jamMs ?? 0);
}

/** Whole seconds for messages ("−2 sn"), at least 1 when anything was cut. */
export function jamSeconds(jamMs: number): number {
  return jamMs <= 0 ? 0 : Math.max(1, Math.round(jamMs / 1000));
}

/** What the player's ladder card says about points at stake. */
export function stakeSummary(rung: { multiplier: number; loss: number }): {
  multiplier: number;
  loss: number;
} {
  return { multiplier: rung.multiplier, loss: rung.loss };
}
