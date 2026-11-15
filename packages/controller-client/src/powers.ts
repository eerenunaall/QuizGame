import type {
  Joker,
  PhaseDataOf,
  PublicOption,
  PublicPlayer,
  RiskTier,
  RoomView,
  SabotageKind,
  TeamId,
  YouView,
} from '@quizparty/protocol';
import { TEAM_IDS } from '@quizparty/protocol';

/**
 * Pure view rules for the prep screen and the answer screen, shared by the browser controller and the
 * native app so both mirror the server's view of powers identically (GDD §10; the server decides).
 */

/** What the phone sends for RISK_PICK: the stake and Double Down, final once sent. */
export interface RiskChoice {
  stake: RiskTier;
  doubleDown: boolean;
  /** ADR-0023 extras; absent = off. */
  cover?: boolean;
  pot?: boolean;
  duel?: { targetId: string } | null;
}

/** What the phone sends for SABOTAGE_PICK: at most one sabotage; null confirms "none". Final once sent. */
export interface SabotageChoice {
  sabotage: SabotagePick | null;
}

/** One sabotage: aimed at a player (individual play) or at a rival team (team play, ADR-0026). */
export type SabotagePick = { effect: SabotageKind; joker?: Joker } & (
  { targetId: string; targetTeamId?: undefined } | { targetTeamId: TeamId; targetId?: undefined }
);

export const SABOTAGE_ORDER: readonly SabotageKind[] = [
  'JAM',
  'SHUFFLE',
  'FOG',
  'LOCKOUT',
  'POINT_TAX',
  'STAKE_CAP',
  'CUT',
  'BLIND_CLOCK',
];
/** What older servers offer (before ADR-0023): the phone shows these when the server sends no list. */
export const ORIGINAL_SABOTAGES: readonly SabotageKind[] = SABOTAGE_ORDER.slice(0, 5);
export const JOKER_ORDER: readonly Joker[] = ['FIFTY_FIFTY', 'DOUBLE_DOWN'];

type PrepData = PhaseDataOf<'RISK_PICK'>;

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

/**
 * "One big gamble per question" (ADR-0021): the server refuses Double Down with the top stakes. The
 * phone mirrors that so neither button invites an illegal pair; absent list = nothing excluded.
 */
export function stakeExcludesDoubleDown(data: PrepData, stake: RiskTier): boolean {
  return data.doubleDownExcludedStakes?.includes(stake) ?? false;
}

/**
 * Why a player cannot sabotage right now. `ready` is the server's own verdict for SABOTAGE_PICK (token,
 * cooldown, a legal target); older servers send none, so the token count decides then.
 */
export function sabotageState(you: YouView | null): Unavailable {
  if (!you?.powers) return 'CLOSED';
  if (you.powers.sabotageTokens <= 0) return 'NO_TOKEN';
  return you.sabotage && !you.sabotage.ready ? 'CLOSED' : null;
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

// ───────────────────────── ADR-0023: Cover, Duel, Pot, Stake Cap, Cut, Blind Clock

/** Why an extra cannot be chosen right now; the phone shows the matching one-line reason. */
export type ExtraBlock =
  'OFF' | 'NONE_LEFT' | 'NEEDS_STAKE' | 'BIG_GAMBLE' | 'POINTS' | 'ROOM_SIZE' | 'NO_RIVAL' | null;

type Offer = NonNullable<PrepData['risks']>;
type Choice = Pick<RiskChoice, 'stake' | 'doubleDown'>;

const TIER_ORDER: readonly RiskTier[] = ['SAFE', 'RISK', 'HIGH', 'ALL_IN'];

/** The highest stake the server lets this player take this round (STAKE_CAP), else null. */
export function stakeCapOf(you: YouView | null): RiskTier | null {
  return you?.powers?.stakeCap ?? null;
}

/** Whether a rung is out of reach for this player because of a STAKE_CAP. */
export function stakeCapped(you: YouView | null, tier: RiskTier): boolean {
  const cap = stakeCapOf(you);
  return cap !== null && TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(cap);
}

/** Cover: needs a rung with something to lose, a use left, and (by default) no Double Down. */
export function coverBlock(data: PrepData, you: YouView | null, choice: Choice): ExtraBlock {
  if (!data.risks?.cover) return 'OFF';
  if ((you?.powers?.cover ?? 0) <= 0) return 'NONE_LEFT';
  const rung = data.riskLadder.find((entry) => entry.tier === choice.stake);
  if (!rung || rung.loss <= 0) return 'NEEDS_STAKE';
  if (choice.doubleDown) return 'BIG_GAMBLE';
  return null;
}

/** The fee Cover would cost at the chosen rung (0 when it is not on offer there). */
export function coverFee(data: PrepData, choice: Choice): number {
  return data.riskLadder.find((entry) => entry.tier === choice.stake)?.coverFee ?? 0;
}

/** Pot: a use left, the ante in hand and a room big enough (`playerCount` = players in the game). */
export function potBlock(
  data: PrepData,
  you: YouView | null,
  score: number,
  playerCount: number,
): ExtraBlock {
  const offer: Offer['pot'] | undefined = data.risks?.pot;
  if (!offer) return 'OFF';
  if ((you?.powers?.pot ?? 0) <= 0) return 'NONE_LEFT';
  if (playerCount < offer.minPlayers) return 'ROOM_SIZE';
  if (score < offer.ante) return 'POINTS';
  return null;
}

/** Duel: a use left, a rival online, and no other big gamble (HIGH, ALL_IN or Double Down). */
export function duelBlock(
  data: PrepData,
  you: YouView | null,
  choice: Choice,
  rivals: number,
  playerCount: number,
): ExtraBlock {
  if (!data.risks?.duel) return 'OFF';
  if ((you?.powers?.duel ?? 0) <= 0) return 'NONE_LEFT';
  if (playerCount < 2) return 'ROOM_SIZE';
  if (rivals <= 0) return 'NO_RIVAL';
  if (choice.doubleDown || bigStake(data, choice.stake)) return 'BIG_GAMBLE';
  return null;
}

/** HIGH and ALL_IN are the big stakes: the same ones that cannot go with Double Down. */
export function bigStake(data: PrepData, stake: RiskTier): boolean {
  return (data.doubleDownExcludedStakes ?? ['HIGH', 'ALL_IN']).includes(stake);
}

/** Players this player may challenge: everyone else who is online. */
export function duelRivals(players: readonly PublicPlayer[], myId: string): PublicPlayer[] {
  return players.filter((player) => player.playerId !== myId && player.connection === 'CONNECTED');
}

/** Duel invites this player still has to answer. */
export function openInvites(you: YouView | null): { challengerId: string }[] {
  return (you?.duelInvites ?? []).filter((invite) => invite.answer === null);
}

/** Whether accepting is allowed given what the player has chosen (they may already hold a stake). */
export function acceptBlock(
  data: PrepData,
  you: YouView | null,
  committed: { stake: RiskTier; doubleDown: boolean; duel?: unknown } | null,
): ExtraBlock {
  if (!data.risks?.duel) return 'OFF';
  if ((you?.duelInvites ?? []).some((invite) => invite.answer === 'ACCEPTED')) return 'NONE_LEFT';
  if (committed && (committed.duel || committed.doubleDown || bigStake(data, committed.stake)))
    return 'BIG_GAMBLE';
  return null;
}

/**
 * The sabotages on the menu this round (older servers send none: the five original ones). The simple
 * ruleset's single prep phase carries the menu on RISK_PICK itself.
 */
export function sabotageKinds(
  data: PhaseDataOf<'SABOTAGE_PICK'> | PhaseDataOf<'RISK_PICK'> | null,
): readonly SabotageKind[] {
  return data?.offered ?? ORIGINAL_SABOTAGES;
}

// ───────────────────────── ADR-0026: teams and the simple ruleset

/** Whether the running game is played in teams (by the room's mode, or by the standings once they exist). */
export function isTeamGame(room: Pick<RoomView, 'game' | 'settings'>): boolean {
  // The standings only arrive with the first score update, but prep comes before it: the room's mode counts too.
  return room.game?.teamBoard !== undefined || room.settings.play === 'TEAMS';
}

/** The teams in the running game other than the player's own, in slot order: what a sabotage may aim at. */
export function rivalTeams(room: Pick<RoomView, 'players' | 'you'>): TeamId[] {
  const own = room.you?.teamId;
  const present = new Set(room.players.map((player) => player.teamId));
  return TEAM_IDS.filter((id) => id !== own && present.has(id));
}

/** What this player still has to decide in the simple ruleset's prep phase (the server's own verdict). */
export function prepNeeds(you: YouView | null): { risk: boolean; sabotage: boolean } {
  return {
    risk: you?.risk?.ready === true && !you.risk.decided,
    sabotage: you?.sabotage?.ready === true && !you.sabotage.decided,
  };
}

/** Whether the prep phase has anything for this player at all (something to decide, or already decided). */
export function prepHasWork(you: YouView | null): boolean {
  const needs = prepNeeds(you);
  return (
    needs.risk || needs.sabotage || you?.risk?.decided === true || you?.sabotage?.decided === true
  );
}

/** Why CUT cannot aim at `targetId`: they lead the table, or have no points to take from. */
export function cutBlock(
  scoreboard: readonly { playerId: string; score: number; rank: number }[],
  targetId: string,
): 'LEADER' | 'NO_POINTS' | null {
  const entry = scoreboard.find((row) => row.playerId === targetId);
  if (!entry) return null;
  if (entry.rank === 1) return 'LEADER';
  if (entry.score <= 0) return 'NO_POINTS';
  return null;
}
