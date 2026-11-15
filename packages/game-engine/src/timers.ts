import { allPlayersGoneMsFor } from './config';
import type { RoomState } from './types';

const IN_GAME_PHASES = new Set([
  'COUNTDOWN',
  'ROUND_INTRO',
  'QUESTION_PREP',
  'RISK_PICK',
  'SABOTAGE_PICK',
  'QUESTION',
  'ANSWERING',
  'LOCKED',
  'REVEAL',
  'POWER_RESOLUTION',
  'SCORE_UPDATE',
  'MICRO_INTERMISSION',
  'NEXT_ROUND',
  'FINAL',
]);

export const isInGamePhase = (phase: RoomState['phase']): boolean => IN_GAME_PHASES.has(phase);

/**
 * When the last active player dropped, if EVERY active player is disconnected right now (so a single
 * connected phone, or a room with nobody seated yet, yields null). A reconnect clears it, because the
 * condition then no longer holds; the window restarts with the next full silence.
 */
export function allPlayersGoneSince(
  state: Pick<RoomState, 'phase' | 'playerOrder' | 'players'>,
): number | null {
  if (state.phase === 'WAITING' || state.phase === 'ROOM_CLOSED') return null;
  let since: number | null = null;
  for (const id of state.playerOrder) {
    const player = state.players[id];
    if (!player || player.status !== 'ACTIVE') continue;
    // A seat without a stamp cannot be dated: treat the room as not (yet) abandoned.
    if (player.connection !== 'DISCONNECTED' || player.disconnectedAt === null) return null;
    since = since === null ? player.disconnectedAt : Math.max(since, player.disconnectedAt);
  }
  return since;
}

/**
 * Whether the leader role has anywhere to go: another active player is connected, or nobody else is
 * seated (the role then just stops waiting). Handing it to another *disconnected* player is
 * pointless and would bounce it back and forth forever while everybody is gone.
 */
export function leaderHandoverPossible(
  state: Pick<RoomState, 'leaderPlayerId' | 'playerOrder' | 'players'>,
): boolean {
  let others = 0;
  for (const id of state.playerOrder) {
    const player = state.players[id];
    if (!player || player.status !== 'ACTIVE' || id === state.leaderPlayerId) continue;
    if (player.connection === 'CONNECTED') return true;
    others += 1;
  }
  return others === 0;
}

/**
 * The earliest time the room needs a `TICK`, or null when nothing is scheduled. The server keeps
 * one timer per room armed to this value and re-arms it after every applied input.
 *
 * Contract (guards against busy loops): every *hard* deadline returned here is consumed by the
 * TICK it triggers (the phase advances, the room closes, leadership is reassigned or the leader
 * timer is cleared). *Soft* timers – conditions that only matter once, at a known instant, and
 * are otherwise re-evaluated by the inputs that change them – are returned only while still in
 * the future relative to `now`, so a TICK that has nothing left to do can never be re-armed at a
 * time that has already passed.
 */
export function nextWakeAt(state: RoomState, now: number): number | null {
  if (state.phase === 'ROOM_CLOSED') return null;
  const { timings } = state.config;
  const candidates: number[] = [state.createdAt + timings.maxLifetimeMs];

  if (state.phaseDeadlineAt !== null) candidates.push(state.phaseDeadlineAt);

  if (state.phase === 'WAITING' || state.phase === 'LOBBY') {
    candidates.push(state.lastActivityAt + timings.lobbyIdleMs);
  } else if (state.phase === 'RESULTS') {
    candidates.push(state.lastActivityAt + timings.resultsIdleMs);
  }

  if (
    isInGamePhase(state.phase) &&
    !state.display.connected &&
    state.display.disconnectedAt !== null
  ) {
    candidates.push(state.display.disconnectedAt + timings.abandonMs);
  }

  const goneSince = allPlayersGoneSince(state);
  if (goneSince !== null) candidates.push(goneSince + allPlayersGoneMsFor(state.config));

  if (
    state.leaderPlayerId !== null &&
    state.leaderLostAt !== null &&
    leaderHandoverPossible(state)
  ) {
    candidates.push(state.leaderLostAt + timings.leaderGraceMs);
  }

  if (state.phase === 'ANSWERING' && state.game?.round) {
    // A disconnected player stops blocking an early lock once their grace expires (soft timer).
    for (const [playerId, gamePlayer] of Object.entries(state.game.players)) {
      const player = state.players[playerId];
      if (gamePlayer.removed || !player || player.connection !== 'DISCONNECTED') continue;
      if (state.game.round.answers[playerId] || player.disconnectedAt === null) continue;
      const expires = player.disconnectedAt + timings.earlyLockGraceMs;
      if (expires > now) candidates.push(expires);
    }
  }

  return Math.min(...candidates);
}
