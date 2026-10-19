import type { ClientPayload, ErrorCode } from '@quizparty/protocol';
import { produce } from 'immer';
import type { CommandResult, RoomState } from './types';
import { Harness, testConfig } from './testing';

/** Shared setup for the ADR-0023 test files (Cover, Pot, Duel, Stake Cap, Cut, Blind Clock). */
export type RiskPatch = Partial<ClientPayload<'COMMIT_RISK'>>;
export type Plan = Record<string, 'correct' | 'wrong' | 'none'>;

export function setup(players = 3, override: unknown = {}) {
  const h = new Harness({ config: testConfig(override) });
  const ids = h.joinPlayers(players);
  h.start();
  return { h, ids };
}

export const refusal = (result: CommandResult): ErrorCode | 'OK' =>
  result.ok ? 'OK' : result.code;

export const risk = (h: Harness, playerId: string, patch: RiskPatch = {}): CommandResult =>
  h.command(h.actor(playerId), {
    type: 'COMMIT_RISK',
    payload: { stake: 'SAFE', doubleDown: false, ...patch },
  });

export const respondDuel = (
  h: Harness,
  playerId: string,
  challengerId: string,
  accept: boolean,
): CommandResult =>
  h.command(h.actor(playerId), { type: 'RESPOND_DUEL', payload: { challengerId, accept } });

export const sabotage = (
  h: Harness,
  playerId: string,
  targetId: string | null,
  effect: ClientPayload<'COMMIT_SABOTAGE'>['sabotage'] extends infer S
    ? S extends { effect: infer E }
      ? E
      : never
    : never = 'JAM',
): CommandResult =>
  h.command(h.actor(playerId), {
    type: 'COMMIT_SABOTAGE',
    payload: { sabotage: targetId ? { targetId, effect } : null },
  });

/** Answers `plan` (default everyone right) at `offsets` ms into the window, then waits for SCORE_UPDATE. */
export function answerAll(
  h: Harness,
  ids: readonly string[],
  plan: Plan = {},
  offsets: Record<string, number> = {},
): void {
  h.runUntil('ANSWERING');
  const opens = h.round().answerOpensAt!;
  ids.forEach((id, index) => {
    const what = plan[id] ?? 'correct';
    if (what === 'none') return;
    h.answer(id, what, opens + (offsets[id] ?? 500 + index * 100));
  });
}

/** Plays whole rounds (everyone right unless `plan` says otherwise) until `index` is in RISK_PICK. */
export function toRound(h: Harness, ids: readonly string[], index: number, plan: Plan = {}): void {
  for (let guard = 0; guard < 60; guard++) {
    h.runUntil('RISK_PICK');
    if (h.round().index === index) return;
    answerAll(h, ids, plan);
    h.runUntil('SCORE_UPDATE');
  }
  throw new Error(`never reached round ${index}`);
}

export const scoreOf = (h: Harness, playerId: string): number =>
  h.state.game!.players[playerId]!.score;

/** What the round just played did to every player: delta and components, from the score update. */
export function settle(h: Harness) {
  h.runUntil('SCORE_UPDATE');
  const deltas = h.round().scoreUpdate!.deltas;
  return Object.fromEntries(deltas.map((d) => [d.playerId, d])) as Record<
    string,
    (typeof deltas)[number]
  >;
}

export const component = (
  entry: { components: { kind: string; points: number }[] } | undefined,
  kind: string,
): number =>
  (entry?.components ?? []).filter((c) => c.kind === kind).reduce((sum, c) => sum + c.points, 0);

export const youOf = (h: Harness, playerId: string) => h.view({ role: 'PLAYER', playerId }).you!;

/** Items of the POWER_RESOLUTION screen of the round just played. */
export function resolutionItems(h: Harness) {
  h.runUntil('POWER_RESOLUTION');
  const data = h.view({ role: 'DISPLAY' }).phaseData;
  if (data.phase !== 'POWER_RESOLUTION') throw new Error(`not resolution: ${data.phase}`);
  return data.items;
}

/** Edits the room the way a stored snapshot could differ (the engine's state is frozen). */
export function edit(h: Harness, recipe: (draft: RoomState) => void): void {
  h.state = produce(h.state, recipe);
}
