import { describe, expect, it } from 'vitest';
import type { Phase } from '@quizparty/protocol';
import {
  DEFAULT_GAME_CONFIG,
  GameConfigSchema,
  allPlayersGoneMsFor,
  resolveGameConfig,
  type GameConfig,
} from './config';
import { nextWakeAt } from './timers';
import { Harness, testConfig } from './testing';

/**
 * "Everybody's phone is gone" (GDD §8.2 follow-up): a room whose active players are ALL
 * disconnected for `timings.allPlayersGoneMs` closes as ABANDONED so the TV falls back to its
 * title menu. Phones that merely lost signal for a moment must never trigger it.
 */
const GONE = DEFAULT_GAME_CONFIG.timings.allPlayersGoneMs!;

const disconnect = (h: Harness, id: string, at = h.now) =>
  h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: false }, at);
const reconnect = (h: Harness, id: string, at = h.now) =>
  h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: true }, at);

describe('allPlayersGoneMs config', () => {
  it('defaults to 45 s', () => {
    expect(GONE).toBe(45_000);
    expect(resolveGameConfig().timings.allPlayersGoneMs).toBe(45_000);
    expect(allPlayersGoneMsFor(testConfig())).toBe(45_000);
  });

  it('is optional so snapshots stored before it existed still parse and fall back to the default', () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_GAME_CONFIG)) as GameConfig;
    delete (old.timings as { allPlayersGoneMs?: number }).allPlayersGoneMs;
    const parsed = GameConfigSchema.parse(old);
    expect(parsed.timings.allPlayersGoneMs).toBeUndefined();
    expect(allPlayersGoneMsFor(parsed)).toBe(45_000);
  });

  it('is bounded to 10 s … 1 h', () => {
    expect(() => resolveGameConfig({ timings: { allPlayersGoneMs: 9_999 } })).toThrow();
    expect(() => resolveGameConfig({ timings: { allPlayersGoneMs: 3_600_001 } })).toThrow();
    expect(
      resolveGameConfig({ timings: { allPlayersGoneMs: 10_000 } }).timings.allPlayersGoneMs,
    ).toBe(10_000);
    expect(
      resolveGameConfig({ timings: { allPlayersGoneMs: 3_600_000 } }).timings.allPlayersGoneMs,
    ).toBe(3_600_000);
  });
});

describe('all players disconnected', () => {
  it('closes a lobby as ABANDONED once the LAST disconnect is allPlayersGoneMs old', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    const t0 = h.now;
    disconnect(h, a, t0 + 1_000);
    disconnect(h, b, t0 + 6_000);
    // measured from the latest disconnect (b), not the earliest
    h.tickAt(t0 + 1_000 + GONE);
    expect(h.state.phase).toBe('LOBBY');
    h.tickAt(t0 + 6_000 + GONE - 1);
    expect(h.state.phase).toBe('LOBBY');
    h.tickAt(t0 + 6_000 + GONE);
    expect(h.state.phase).toBe('ROOM_CLOSED');
    expect(h.state.closed?.reason).toBe('ABANDONED');
    expect(h.effects.some((e) => e.kind === 'closeRoom')).toBe(true);
  });

  it('a single connected player keeps the room open however long the others are gone', () => {
    const h = new Harness();
    const [a, b, c] = h.joinPlayers(3) as [string, string, string];
    disconnect(h, a);
    disconnect(h, b);
    h.tickAt(h.now + 10 * GONE);
    expect(h.state.phase).toBe('LOBBY');
    expect(h.state.players[c]!.connection).toBe('CONNECTED');
  });

  it('a reconnect resets the clock; the next full silence starts it again', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    const t0 = h.now;
    disconnect(h, a, t0);
    disconnect(h, b, t0 + 1_000);
    reconnect(h, a, t0 + 30_000);
    h.tickAt(t0 + 100_000);
    expect(h.state.phase).toBe('LOBBY');
    // a drops again: the window restarts from this disconnect, b's old one does not count
    disconnect(h, a, t0 + 100_000);
    h.tickAt(t0 + 100_000 + GONE - 1);
    expect(h.state.phase).toBe('LOBBY');
    h.tickAt(t0 + 100_000 + GONE);
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });

  it('honours a configured window', () => {
    const h = new Harness({ config: testConfig({ timings: { allPlayersGoneMs: 10_000 } }) });
    const [a] = h.joinPlayers(1) as [string];
    disconnect(h, a);
    h.tickAt(h.now + 9_999);
    expect(h.state.phase).toBe('LOBBY');
    h.tickAt(h.now + 1);
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });

  it('falls back to the default for a stored config that predates the field', () => {
    const config = testConfig();
    delete (config.timings as { allPlayersGoneMs?: number }).allPlayersGoneMs;
    const h = new Harness({ config });
    const [a] = h.joinPlayers(1) as [string];
    disconnect(h, a);
    h.tickAt(h.now + GONE - 1);
    expect(h.state.phase).toBe('LOBBY');
    h.tickAt(h.now + 1);
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });

  it('ignores players who left or were kicked: only ACTIVE seats count', () => {
    const h = new Harness();
    const [a, b, c] = h.joinPlayers(3) as [string, string, string];
    h.command(h.actor(c), { type: 'LEAVE_ROOM', payload: {} });
    h.command(h.displayActor(), { type: 'KICK_PLAYER', payload: { playerId: b } });
    expect(h.state.phase).toBe('LOBBY');
    disconnect(h, a);
    h.tickAt(h.now + GONE);
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });

  it('never fires in WAITING (nobody has joined, so nobody can be "gone")', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(1) as [string];
    h.command(h.actor(a), { type: 'LEAVE_ROOM', payload: {} });
    expect(h.state.phase).toBe('WAITING');
    h.tickAt(h.now + 20 * GONE);
    expect(h.state.phase).toBe('WAITING');
    expect(nextWakeAt(h.state, h.now)).toBe(
      h.state.lastActivityAt + h.state.config.timings.lobbyIdleMs,
    );
  });

  const IN_GAME: Phase[] = [
    'COUNTDOWN',
    'ROUND_INTRO',
    'QUESTION_PREP',
    'QUESTION',
    'ANSWERING',
    'LOCKED',
    'REVEAL',
    'SCORE_UPDATE',
    'MICRO_INTERMISSION',
    'FINAL',
    'RESULTS',
  ];
  for (const phase of IN_GAME) {
    it(`closes from ${phase}`, () => {
      const h = new Harness();
      const ids = h.joinPlayers(3);
      h.start();
      h.runUntil(phase);
      const t0 = h.now;
      ids.forEach((id, i) => disconnect(h, id, t0 + i * 100));
      h.tickAt(t0 + 200 + GONE - 1);
      expect(h.state.phase, 'still inside the window').not.toBe('ROOM_CLOSED');
      h.tickAt(t0 + 200 + GONE);
      expect(h.state.closed?.reason).toBe('ABANDONED');
    });
  }

  it('keeps the results of a finished game (phone-less TV can still show them until it returns)', () => {
    const h = new Harness();
    const ids = h.joinPlayers(2);
    h.start();
    h.runUntil('RESULTS');
    const ranking = h.state.game!.results!.ranking;
    for (const id of ids) disconnect(h, id);
    h.tickAt(h.now + GONE);
    expect(h.state.closed?.reason).toBe('ABANDONED');
    expect(h.state.game!.results!.ranking).toEqual(ranking);
  });
});

describe('nextWakeAt covers the all-gone deadline', () => {
  it('arms a timer exactly at the latest disconnect + window, which the tick consumes', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    const t0 = h.now;
    disconnect(h, b, t0 + 1_000); // not the leader, so no leader hand-over is due
    expect(nextWakeAt(h.state, h.now)).toBeGreaterThan(t0 + 1_000 + GONE); // a still connected
    disconnect(h, a, t0 + 2_000);
    expect(nextWakeAt(h.state, h.now)).toBe(t0 + 2_000 + GONE);
    h.step();
    expect(h.state.closed?.reason).toBe('ABANDONED');
    expect(nextWakeAt(h.state, h.now)).toBeNull(); // no busy loop on a closed room
  });

  it('drops the deadline again when somebody comes back', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    disconnect(h, a);
    disconnect(h, b);
    const armed = nextWakeAt(h.state, h.now)!;
    reconnect(h, a, h.now + 5_000);
    expect(nextWakeAt(h.state, h.now)).toBeGreaterThan(armed);
  });

  it('stepping through a game whose phones all vanish ends in ABANDONED, never in a stall', () => {
    const h = new Harness();
    const ids = h.joinPlayers(2);
    h.start();
    h.runUntil('ANSWERING');
    for (const id of ids) disconnect(h, id);
    h.runWhile(() => h.state.phase !== 'ROOM_CLOSED');
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });
});

describe('leader hand-over while everybody is disconnected', () => {
  // Regression: with two or more phones all gone for longer than leaderGraceMs the TICK passed the
  // leader role to the other disconnected player, which re-armed at once and passed it back, a hot
  // loop of durable events until someone came back.
  it('does not ping-pong the leader role between disconnected players', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    const t0 = h.now;
    const grace = h.state.config.timings.leaderGraceMs;
    expect(h.state.leaderPlayerId).toBe(a);
    disconnect(h, a, t0);
    disconnect(h, b, t0 + 100);
    h.tickAt(t0 + grace + 1_000);
    expect(h.state.leaderPlayerId).toBe(a);
    const wake = nextWakeAt(h.state, h.now)!;
    expect(wake).toBeGreaterThan(h.now);
    expect(wake).toBe(t0 + 100 + GONE); // the next thing that can happen is the all-gone close
  });

  it('hands the role to the first phone that comes back', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    const t0 = h.now;
    disconnect(h, a, t0);
    disconnect(h, b, t0 + 100);
    h.tickAt(t0 + h.state.config.timings.leaderGraceMs + 1_000);
    reconnect(h, b, t0 + 30_000);
    expect(nextWakeAt(h.state, h.now)).toBeLessThanOrEqual(h.now); // a hand-over is due
    h.step();
    expect(h.state.leaderPlayerId).toBe(b);
    expect(h.state.leaderLostAt).toBeNull();
  });

  it('still hands over when the other players are connected (unchanged behaviour)', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    disconnect(h, a);
    h.tickAt(h.now + h.state.config.timings.leaderGraceMs);
    expect(h.state.leaderPlayerId).toBe(b);
  });
});

describe('server restart (ADR-0006) must not look like "everybody left"', () => {
  /**
   * A restart drops every socket at once; `RECOVER` marks all seats DISCONNECTED *at the recovery
   * instant* (never at the pre-crash instant), so phones that auto-reconnect within seconds get the
   * whole window, however long the process was down.
   */
  it('starts the window at the recovery instant, not when the process died', () => {
    const h = new Harness();
    const ids = h.joinPlayers(3);
    h.start();
    h.runUntil('ANSWERING');
    // one phone had been offline for 40 s before the crash; its old stamp must not shorten the window
    disconnect(h, ids[0]!, h.now);
    const outage = 5 * 60_000; // within maxRecoverableOutageMs, far above allPlayersGoneMs
    const recoveredAt = h.now + 40_000 + outage;
    h.apply({ kind: 'RECOVER', outageMs: outage }, recoveredAt);
    expect(h.state.phase).not.toBe('ROOM_CLOSED');
    for (const id of ids) expect(h.state.players[id]!.disconnectedAt).toBe(recoveredAt);

    h.tickAt(recoveredAt + GONE - 1);
    expect(h.state.phase).not.toBe('ROOM_CLOSED');
  });

  it('keeps the room when phones reconnect within seconds of the restart', () => {
    const h = new Harness();
    const ids = h.joinPlayers(3);
    h.start();
    h.runUntil('ANSWERING');
    const recoveredAt = h.now + 60_000;
    h.apply({ kind: 'RECOVER', outageMs: 60_000 }, recoveredAt);
    // phones come back with the client's backoff: 0.5 s, 2 s and 8 s later
    reconnect(h, ids[0]!, recoveredAt + 500);
    reconnect(h, ids[1]!, recoveredAt + 2_000);
    reconnect(h, ids[2]!, recoveredAt + 8_000);
    h.tickAt(recoveredAt + 10 * GONE);
    expect(h.state.closed).toBeNull();
    expect(h.state.phase).not.toBe('ROOM_CLOSED');
  });

  it('one phone back is enough to keep the room even if the others never return', () => {
    const h = new Harness();
    const ids = h.joinPlayers(3);
    h.start();
    h.runUntil('ANSWERING');
    const recoveredAt = h.now + 1_000;
    h.apply({ kind: 'RECOVER', outageMs: 1_000 }, recoveredAt);
    reconnect(h, ids[0]!, recoveredAt + 3_000);
    h.tickAt(recoveredAt + 10 * GONE);
    expect(h.state.closed).toBeNull();
  });

  it('closes after the window when nobody came back from a restart', () => {
    const h = new Harness();
    h.joinPlayers(2);
    h.start();
    h.runUntil('ANSWERING');
    const recoveredAt = h.now + 2_000;
    h.apply({ kind: 'RECOVER', outageMs: 2_000 }, recoveredAt);
    h.tickAt(recoveredAt + GONE);
    expect(h.state.closed?.reason).toBe('ABANDONED');
  });

  it('a lobby recovered after a restart gets the same window', () => {
    const h = new Harness();
    const ids = h.joinPlayers(2);
    const recoveredAt = h.now + 120_000;
    h.apply({ kind: 'RECOVER', outageMs: 120_000 }, recoveredAt);
    h.tickAt(recoveredAt + GONE - 1);
    expect(h.state.phase).toBe('LOBBY');
    reconnect(h, ids[1]!, recoveredAt + GONE - 1);
    h.tickAt(recoveredAt + 5 * GONE);
    expect(h.state.phase).toBe('LOBBY');
  });
});
