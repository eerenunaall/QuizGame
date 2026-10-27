import type { ClientPayload, ErrorCode, TeamId } from '@quizparty/protocol';
import type { CommandResult } from './types';
import { Harness, testConfig } from './testing';

/** Shared setup for the ADR-0026 test files (teams and the simple ruleset). */
export type Settings = ClientPayload<'SET_SETTINGS'>;

export const refusal = (result: CommandResult): ErrorCode | 'OK' =>
  result.ok ? 'OK' : result.code;

/** A room with `players` joined and the host's settings applied, still in the lobby. */
export function lobby(players: number, settings: Settings = {}, override: unknown = {}) {
  const h = new Harness({ config: testConfig(override) });
  const ids = h.joinPlayers(players);
  if (Object.keys(settings).length > 0) set(h, settings);
  return { h, ids };
}

export const set = (h: Harness, settings: Settings): CommandResult =>
  h.command(h.state.leaderPlayerId ? h.actor(h.state.leaderPlayerId) : h.displayActor(), {
    type: 'SET_SETTINGS',
    payload: settings,
  });

export const assign = (h: Harness, who: string, teamId: TeamId, playerId?: string): CommandResult =>
  h.command(who === 'display' ? h.displayActor() : h.actor(who), {
    type: 'ASSIGN_TEAM',
    payload: playerId === undefined ? { teamId } : { teamId, playerId },
  });

export const teamOf = (h: Harness, playerId: string): TeamId | undefined =>
  h.state.players[playerId]!.teamId;

/** Everyone's team in join order, e.g. `['tiger', 'owl', 'tiger']`. */
export const teamsOf = (h: Harness): (TeamId | undefined)[] =>
  h.state.playerOrder.map((id) => teamOf(h, id));

/** A started team game of the simple ruleset (the café default), `players` split by the lobby rules. */
export function teamGame(players = 4, override: unknown = {}, settings: Settings = {}) {
  const { h, ids } = lobby(players, { play: 'TEAMS', ruleset: 'SIMPLE', ...settings }, override);
  const started = h.start();
  if (!started.ok) throw new Error(`start refused: ${started.code}`);
  return { h, ids };
}

export const commitRisk = (h: Harness, playerId: string, doubleDown = false): CommandResult =>
  h.command(h.actor(playerId), {
    type: 'COMMIT_RISK',
    payload: { stake: 'SAFE', doubleDown },
  });

export const hitTeam = (
  h: Harness,
  playerId: string,
  targetTeamId: TeamId,
  effect: ClientPayload<'COMMIT_SABOTAGE'>['sabotage'] extends infer S
    ? S extends { effect: infer E }
      ? E
      : never
    : never = 'JAM',
): CommandResult =>
  h.command(h.actor(playerId), {
    type: 'COMMIT_SABOTAGE',
    payload: { sabotage: { targetTeamId, effect } },
  });

export const hitPlayer = (
  h: Harness,
  playerId: string,
  targetId: string,
  effect: 'JAM' | 'SHUFFLE' | 'BLIND_CLOCK' | 'FOG' = 'JAM',
): CommandResult =>
  h.command(h.actor(playerId), {
    type: 'COMMIT_SABOTAGE',
    payload: { sabotage: { targetId, effect } },
  });

export const pass = (h: Harness, playerId: string): CommandResult =>
  h.command(h.actor(playerId), { type: 'COMMIT_SABOTAGE', payload: { sabotage: null } });

/**
 * Plays whole questions (`plan` says who answers right, default everyone) until question `index` has
 * reached its prep window (RISK_PICK) or, when nobody had anything to prepare, the question itself.
 */
export function toRound(
  h: Harness,
  ids: readonly string[],
  index: number,
  plan: Record<string, 'correct' | 'wrong' | 'none'> = {},
): void {
  for (let guard = 0; guard < 4000; guard++) {
    const round = h.state.game?.round;
    if (round?.index === index && (h.state.phase === 'RISK_PICK' || h.state.phase === 'QUESTION'))
      return;
    if (h.state.phase === 'ANSWERING' && round && round.index < index) answerPlan(h, ids, plan);
    if (!h.step()) break;
  }
  throw new Error(`never reached round ${index}`);
}

function answerPlan(
  h: Harness,
  ids: readonly string[],
  plan: Record<string, 'correct' | 'wrong' | 'none'>,
): void {
  const opens = h.round().answerOpensAt!;
  ids.forEach((id, i) => {
    const what = plan[id] ?? 'correct';
    if (what !== 'none') h.answer(id, what, opens + 500 + i * 100);
  });
}

/** Runs the answer window of the current round: `plan` answers, then waits for the score update. */
export function playRound(
  h: Harness,
  ids: readonly string[],
  plan: Record<string, 'correct' | 'wrong' | 'none'> = {},
): void {
  h.runUntil('ANSWERING');
  answerPlan(h, ids, plan);
  h.runUntil('SCORE_UPDATE');
}
