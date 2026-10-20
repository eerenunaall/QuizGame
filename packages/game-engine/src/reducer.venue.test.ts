import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from './config';
import { createRoom, reduce } from './reducer';
import { Harness, TEST_ROOM_ID } from './testing';
import type { VenueMeter } from './venue';

/** Venue mode in the engine (ADR-0024 §4): the meter gates new games and ends a game after its round. */
const running = (h: Harness, ms: number): VenueMeter => ({
  state: 'RUNNING',
  endsAt: h.now + ms,
  remainingMs: 0,
});
const setMeter = (h: Harness, meter: VenueMeter | null) => h.apply({ kind: 'VENUE_METER', meter });

function venueRoom(players = 3): { h: Harness; ids: string[] } {
  const h = new Harness();
  const ids = h.joinPlayers(players);
  return { h, ids };
}

describe('venue meter in the lobby', () => {
  it('is public room information and nothing else of a venue is', () => {
    const { h, ids } = venueRoom();
    expect('venue' in h.view({ role: 'DISPLAY' })).toBe(false);
    setMeter(h, running(h, 120_000));
    const events = h.events('VENUE_METER_CHANGED');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      venue: { state: 'RUNNING', endsAt: h.now + 120_000, remainingMs: 120_000 },
    });
    for (const viewer of [
      { role: 'DISPLAY' as const },
      { role: 'PLAYER' as const, playerId: ids[0]! },
    ])
      expect(h.view(viewer).venue).toEqual({
        state: 'RUNNING',
        endsAt: h.now + 120_000,
        remainingMs: 120_000,
      });
  });

  it('lets a game start while time remains', () => {
    const { h } = venueRoom();
    setMeter(h, running(h, 120_000));
    expect(h.start()).toEqual({ ok: true });
    expect(h.state.phase).toBe('COUNTDOWN');
  });

  it('refuses START_GAME with VENUE_TIME_UP once the time is used up, and VENUE_PAUSED while paused', () => {
    const { h } = venueRoom();
    setMeter(h, running(h, 1_000));
    h.tickAt(h.now + 1_000);
    expect(h.start()).toEqual({ ok: false, code: 'VENUE_TIME_UP' });
    setMeter(h, { state: 'PAUSED', endsAt: null, remainingMs: 30_000 });
    expect(h.start()).toEqual({ ok: false, code: 'VENUE_PAUSED' });
    setMeter(h, { state: 'ENDED', endsAt: null, remainingMs: 30_000 });
    expect(h.start()).toEqual({ ok: false, code: 'VENUE_TIME_UP' });
    expect(h.state.phase).toBe('LOBBY');
    expect(h.effects.some((e) => e.kind === 'needDeck')).toBe(false);
  });

  it('refuses the deck hand-shake when the time ran out while the deck was being built', () => {
    const { h } = venueRoom();
    setMeter(h, running(h, 500));
    const leader = h.state.leaderPlayerId!;
    const result = h.apply({
      kind: 'COMMAND',
      actor: h.actor(leader),
      command: { type: 'START_GAME', payload: {} },
      messageId: '00000000-0000-4000-9000-000000000999',
    });
    expect(result.ok).toBe(true);
    h.now += 600;
    h.fulfilDeckRequests();
    expect(h.state.phase).toBe('LOBBY');
    expect(h.state.game).toBeNull();
  });

  it('keeps a held table open past the lobby idle limit and lets it close once the table is ended', () => {
    const { h, ids } = venueRoom(2);
    setMeter(h, running(h, 3 * 3_600_000));
    for (const id of ids) h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: false });
    h.tickAt(h.now + DEFAULT_GAME_CONFIG.timings.lobbyIdleMs + 60_000);
    expect(h.state.phase).toBe('LOBBY');
    setMeter(h, { state: 'ENDED', endsAt: null, remainingMs: 0 });
    h.tickAt(h.now + 1);
    expect(h.state.phase).toBe('ROOM_CLOSED');
  });

  it('changes nothing for a room that never had a meter', () => {
    const { h } = venueRoom();
    h.tickAt(h.now + DEFAULT_GAME_CONFIG.timings.lobbyIdleMs);
    expect(h.state.phase).toBe('ROOM_CLOSED');
    expect(h.events('VENUE_METER_CHANGED')).toHaveLength(0);
  });
});

describe('time-up during a game', () => {
  it('never cuts a question: the round in progress finishes, then results show (cut short)', () => {
    const { h, ids } = venueRoom();
    setMeter(h, running(h, 3_600_000));
    h.start();
    h.runUntil('ANSWERING');
    expect(h.state.game!.totalRounds).toBeGreaterThan(1);
    // The paid time runs out while the question is open: answers are still taken.
    setMeter(h, running(h, 1_000));
    h.tickAt(h.now + 1_001);
    expect(h.state.phase).toBe('ANSWERING');
    for (const id of ids) expect(h.answer(id, 'correct', h.now)).toEqual({ ok: true });
    h.runUntil('SCORE_UPDATE');
    expect(h.state.game!.round!.outcome).not.toBeNull();
    h.runUntil('RESULTS');
    expect(h.state.game!.roundIndex).toBe(0);
    expect(h.state.game!.results!.cutShort).toBe(true);
    expect(h.phaseEvents()).not.toContain('MICRO_INTERMISSION');
    // results frames carry no trace of it
    expect(JSON.stringify(h.view({ role: 'DISPLAY' }).phaseData)).not.toContain('cutShort');
  });

  it('a pause in the middle of a game ends it after the round, like time-up', () => {
    const { h } = venueRoom();
    setMeter(h, running(h, 3_600_000));
    h.start();
    h.runUntil('ANSWERING');
    setMeter(h, { state: 'PAUSED', endsAt: null, remainingMs: 3_000_000 });
    h.runUntil('RESULTS');
    expect(h.state.game!.results!.cutShort).toBe(true);
  });

  it('a game with time to spare plays every round and is not cut short', () => {
    const { h } = venueRoom();
    setMeter(h, running(h, 3_600_000));
    h.start();
    h.runUntil('RESULTS');
    expect(h.state.game!.roundIndex).toBe(h.state.game!.totalRounds - 1);
    expect(h.state.game!.results!.cutShort).toBeUndefined();
  });

  it('REMATCH is refused after time-up and allowed again after an extension, without reload', () => {
    const { h } = venueRoom();
    setMeter(h, running(h, 1_000));
    h.start();
    h.runUntil('RESULTS');
    const leader = h.actor(h.state.leaderPlayerId!);
    expect(h.command(leader, { type: 'REMATCH', payload: {} })).toEqual({
      ok: false,
      code: 'VENUE_TIME_UP',
    });
    setMeter(h, running(h, 15 * 60_000));
    expect(h.command(leader, { type: 'REMATCH', payload: {} })).toEqual({ ok: true });
    expect(h.state.phase).toBe('COUNTDOWN');
  });
});

describe('replay', () => {
  it('reproduces the same state from the logged inputs (the meter is an input like any other)', () => {
    const { h, ids } = venueRoom();
    setMeter(h, running(h, 5_000));
    h.start();
    h.runUntil('ANSWERING');
    h.answer(ids[0]!, 'correct');
    h.runUntil('RESULTS');
    let state = createRoom({
      roomId: TEST_ROOM_ID,
      code: 'ABC234',
      displaySessionId: h.displaySessionId,
      now: 1_700_000_000_000,
      config: h.state.config,
      tier: 'FULL',
    });
    for (const input of h.inputs) state = reduce(state, input).state;
    expect(state).toEqual(h.state);
  });
});
