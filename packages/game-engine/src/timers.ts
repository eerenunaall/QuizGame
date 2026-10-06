import type { RoomState } from './types';

const IN_GAME_PHASES = new Set([
  'COUNTDOWN',
  'ROUND_INTRO',
  'QUESTION_PREP',
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

  if (state.leaderPlayerId !== null && state.leaderLostAt !== null) {
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
