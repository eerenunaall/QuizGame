import { describe, expect, it } from 'vitest';
import { makeDeck, testConfig, Harness } from './testing';

const events = (h: Harness, type: Parameters<Harness['events']>[0]) =>
  h.events(type).map((e) => e.payload);

describe('room lifecycle: joining', () => {
  it('starts in WAITING and moves to LOBBY on the first join, making that player the leader', () => {
    const h = new Harness();
    expect(h.state.phase).toBe('WAITING');
    const a = h.join('Ece');
    expect(h.state.phase).toBe('LOBBY');
    expect(h.state.leaderPlayerId).toBe(a);
    expect(events(h, 'PLAYER_JOINED')).toHaveLength(1);
    expect(events(h, 'LEADER_CHANGED')).toEqual([{ playerId: a }]);
    expect(h.phaseEvents()).toEqual(['LOBBY']);
  });

  it('assigns the lowest free colour slot and reuses slots freed by leavers', () => {
    const h = new Harness();
    const [a, b, c] = h.joinPlayers(3) as [string, string, string];
    expect([a, b, c].map((id) => h.state.players[id]!.colorSlot)).toEqual([1, 2, 3]);
    h.command(h.actor(b), { type: 'LEAVE_ROOM', payload: {} });
    const d = h.join('Newcomer');
    expect(h.state.players[d]!.colorSlot).toBe(2);
  });

  it('rejects joins when the room is full', () => {
    const h = new Harness({ config: testConfig({ maxPlayers: 2 }) });
    h.joinPlayers(2);
    const result = h.apply({
      kind: 'PLAYER_JOIN',
      player: { playerId: 'x', sessionId: 's-x', nickname: 'X', nicknameKey: 'x', avatarId: 'fox' },
    });
    expect(result).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('keeps nicknames unique per room by key and frees them when the owner leaves', () => {
    const h = new Harness();
    const a = h.join('Ece');
    const clash = h.apply({
      kind: 'PLAYER_JOIN',
      player: {
        playerId: 'y',
        sessionId: 's-y',
        nickname: 'ECE',
        nicknameKey: 'ece',
        avatarId: 'fox',
      },
    });
    expect(clash).toEqual({ ok: false, code: 'NICKNAME_TAKEN' });
    h.command(h.actor(a), { type: 'LEAVE_ROOM', payload: {} });
    const retry = h.apply({
      kind: 'PLAYER_JOIN',
      player: {
        playerId: 'y',
        sessionId: 's-y',
        nickname: 'ECE',
        nicknameKey: 'ece',
        avatarId: 'fox',
      },
    });
    expect(retry.ok).toBe(true);
  });

  it('rejects a duplicate player id and joins after the game started', () => {
    const h = new Harness();
    h.joinPlayers(2);
    const dup = h.apply({
      kind: 'PLAYER_JOIN',
      player: {
        playerId: 'p1',
        sessionId: 'other',
        nickname: 'Other',
        nicknameKey: 'other',
        avatarId: 'fox',
      },
    });
    expect(dup).toEqual({ ok: false, code: 'ALREADY_JOINED' });
    h.start();
    const late = h.apply({
      kind: 'PLAYER_JOIN',
      player: {
        playerId: 'late',
        sessionId: 's-late',
        nickname: 'Late',
        nicknameKey: 'late',
        avatarId: 'fox',
      },
    });
    expect(late).toEqual({ ok: false, code: 'GAME_IN_PROGRESS' });
  });

  it('a rejected join leaves state and version untouched', () => {
    const h = new Harness();
    h.joinPlayers(2);
    const before = h.state;
    h.apply({
      kind: 'PLAYER_JOIN',
      player: {
        playerId: 'p1',
        sessionId: 'z',
        nickname: 'Dup',
        nicknameKey: 'dup',
        avatarId: 'fox',
      },
    });
    expect(h.state).toBe(before);
  });
});

describe('lobby commands', () => {
  it('toggles ready only in the lobby', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string];
    expect(h.command(h.actor(a), { type: 'READY', payload: { ready: true } }).ok).toBe(true);
    expect(h.state.players[a]!.ready).toBe(true);
    expect(events(h, 'PLAYER_STATUS').at(-1)).toMatchObject({ playerId: a, ready: true });
    h.start();
    expect(h.command(h.actor(a), { type: 'READY', payload: { ready: false } })).toEqual({
      ok: false,
      code: 'INVALID_STATE',
    });
  });

  it('renames players with uniqueness enforced', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    expect(
      h.command(h.actor(a), { type: 'SET_NICKNAME', payload: { nickname: 'Zeynep' } }).ok,
    ).toBe(true);
    expect(h.state.players[a]!.nickname).toBe('Zeynep');
    expect(
      h.command(h.actor(b), { type: 'SET_NICKNAME', payload: { nickname: 'ZEYNEP' } }),
    ).toEqual({
      ok: false,
      code: 'NICKNAME_TAKEN',
    });
  });

  it('lets only the display or the leader change settings, clamped by tier', () => {
    const free = new Harness({ tier: 'FREE' });
    const [leader, other] = free.joinPlayers(2) as [string, string];
    expect(free.state.settings.rounds).toBe(6);
    expect(
      free.command(free.actor(other), { type: 'SET_SETTINGS', payload: { rounds: 4 } }),
    ).toEqual({
      ok: false,
      code: 'NOT_HOST',
    });
    expect(
      free.command(free.actor(leader), { type: 'SET_SETTINGS', payload: { rounds: 10 } }).ok,
    ).toBe(true);
    expect(free.state.settings.rounds).toBe(6); // FREE tier cap
    expect(
      free.command(free.displayActor(), {
        type: 'SET_SETTINGS',
        payload: { categories: ['history'] },
      }).ok,
    ).toBe(true);
    expect(free.state.settings.categories).toEqual(['history']);

    const full = new Harness({ tier: 'FULL' });
    const [fullLeader] = full.joinPlayers(2) as [string];
    full.command(full.actor(fullLeader), { type: 'SET_SETTINGS', payload: { rounds: 10 } });
    expect(full.state.settings.rounds).toBe(10);
  });

  it('kicks players (host only, never yourself) and reassigns the leader when needed', () => {
    const h = new Harness();
    const [a, b, c] = h.joinPlayers(3) as [string, string, string];
    expect(h.command(h.actor(b), { type: 'KICK_PLAYER', payload: { playerId: c } })).toEqual({
      ok: false,
      code: 'NOT_HOST',
    });
    expect(h.command(h.actor(a), { type: 'KICK_PLAYER', payload: { playerId: a } })).toEqual({
      ok: false,
      code: 'INVALID_STATE',
    });
    expect(h.command(h.displayActor(), { type: 'KICK_PLAYER', payload: { playerId: a } }).ok).toBe(
      true,
    );
    expect(h.state.players[a]!.status).toBe('KICKED');
    expect(h.state.playerOrder).toEqual([b, c]);
    expect(h.state.leaderPlayerId).toBe(b);
    expect(
      h.effects.some((e) => e.kind === 'kick' && e.playerId === a && e.reason === 'KICKED'),
    ).toBe(true);
    // a kicked player's commands are no longer accepted
    expect(h.command(h.actor(a), { type: 'READY', payload: { ready: true } })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });

  it('returns to WAITING when the last player leaves and promotes the next leader otherwise', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    h.command(h.actor(a), { type: 'LEAVE_ROOM', payload: {} });
    expect(h.state.leaderPlayerId).toBe(b);
    h.command(h.actor(b), { type: 'LEAVE_ROOM', payload: {} });
    expect(h.state.phase).toBe('WAITING');
    expect(h.state.leaderPlayerId).toBeNull();
  });

  it('migrates leadership deterministically after the grace period', () => {
    const h = new Harness();
    const [a, b, c] = h.joinPlayers(3) as [string, string, string];
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: a, connected: false });
    const lostAt = h.now;
    h.tickAt(lostAt + h.state.config.timings.leaderGraceMs - 1);
    expect(h.state.leaderPlayerId).toBe(a); // still within grace
    h.tickAt(lostAt + h.state.config.timings.leaderGraceMs);
    expect(h.state.leaderPlayerId).toBe(b); // lowest join index among connected players
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: a, connected: true });
    expect(h.state.leaderPlayerId).toBe(b); // the returning player does not auto-reclaim
    expect(h.state.players[c]!.status).toBe('ACTIVE');
  });

  it('transfers leadership explicitly (host only)', () => {
    const h = new Harness();
    const [a, b, c] = h.joinPlayers(3) as [string, string, string];
    expect(h.command(h.actor(b), { type: 'TRANSFER_LEADER', payload: { playerId: c } }).ok).toBe(
      false,
    );
    expect(h.command(h.actor(a), { type: 'TRANSFER_LEADER', payload: { playerId: c } }).ok).toBe(
      true,
    );
    expect(h.state.leaderPlayerId).toBe(c);
  });

  it('rejects forged actors: wrong session for a player or for the display', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string];
    expect(
      h.command(
        { role: 'PLAYER', sessionId: 'stolen', playerId: a },
        { type: 'READY', payload: { ready: true } },
      ),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(
      h.command(
        { role: 'DISPLAY', sessionId: 'not-the-display' },
        { type: 'END_ROOM', payload: {} },
      ),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(h.state.phase).toBe('LOBBY');
  });
});

describe('starting a game', () => {
  it('needs enough connected players and the host', () => {
    const h = new Harness();
    const [a, b] = h.joinPlayers(2) as [string, string];
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: b, connected: false });
    expect(h.command(h.actor(a), { type: 'START_GAME', payload: {} })).toEqual({
      ok: false,
      code: 'NOT_ENOUGH_PLAYERS',
    });
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: b, connected: true });
    expect(h.command(h.actor(b), { type: 'START_GAME', payload: {} })).toEqual({
      ok: false,
      code: 'NOT_HOST',
    });
    expect(h.command(h.actor(a), { type: 'START_GAME', payload: {} }).ok).toBe(true);
    expect(h.state.phase).toBe('COUNTDOWN');
  });

  it('START_GAME alone does not change state: it asks for a deck', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string];
    const before = h.state;
    h.apply({
      kind: 'COMMAND',
      actor: h.actor(a),
      command: { type: 'START_GAME', payload: {} },
      messageId: 'm',
    });
    expect(h.state).toBe(before);
    const need = h.effects.find((e) => e.kind === 'needDeck');
    expect(need).toMatchObject({
      kind: 'needDeck',
      purpose: 'START',
      request: { rounds: 10, tier: 'FULL' },
    });
  });

  it('refuses a deck that is too small and a second BEGIN_GAME', () => {
    const h = new Harness();
    h.joinPlayers(2);
    expect(h.startWith(makeDeck(3))).toEqual({ ok: false, code: 'NOT_ENOUGH_QUESTIONS' });
    expect(h.state.phase).toBe('LOBBY');
    expect(h.startWith(makeDeck(24)).ok).toBe(true);
    const again = h.apply({
      kind: 'BEGIN_GAME',
      requestedBy: h.displayActor(),
      purpose: 'START',
      gameId: 'g2',
      deck: makeDeck(24),
    });
    expect(again).toEqual({ ok: false, code: 'INVALID_STATE' });
  });

  it('BEGIN_GAME re-checks host authority', () => {
    const h = new Harness();
    const [, b] = h.joinPlayers(2) as [string, string];
    const result = h.apply({
      kind: 'BEGIN_GAME',
      requestedBy: h.actor(b),
      purpose: 'START',
      gameId: 'g1',
      deck: makeDeck(24),
    });
    expect(result).toEqual({ ok: false, code: 'NOT_HOST' });
  });

  it('free-tier hosts get shorter games', () => {
    const h = new Harness({ tier: 'FREE' });
    h.joinPlayers(2);
    h.start();
    expect(h.state.game!.totalRounds).toBe(6);
  });
});

describe('room closing', () => {
  it('closes an idle lobby and records the reason', () => {
    const h = new Harness();
    h.joinPlayers(1);
    const { lobbyIdleMs } = h.state.config.timings;
    h.tickAt(h.now + lobbyIdleMs - 1);
    expect(h.state.phase).toBe('LOBBY');
    h.tickAt(h.now + 2);
    expect(h.state.phase).toBe('ROOM_CLOSED');
    expect(h.state.closed?.reason).toBe('IDLE');
    expect(h.effects.some((e) => e.kind === 'closeRoom')).toBe(true);
  });

  it('closes at the absolute lifetime limit even mid-game', () => {
    const h = new Harness();
    h.joinPlayers(2);
    h.start();
    h.tickAt(h.state.createdAt + h.state.config.timings.maxLifetimeMs);
    expect(h.state.closed?.reason).toBe('LIFETIME');
  });

  it('lets the host end the room and ignores everything afterwards', () => {
    const h = new Harness();
    h.joinPlayers(2);
    expect(h.command(h.displayActor(), { type: 'END_ROOM', payload: {} }).ok).toBe(true);
    expect(h.state.closed?.reason).toBe('HOST_ENDED');
    const late = h.apply({
      kind: 'PLAYER_JOIN',
      player: {
        playerId: 'late',
        sessionId: 's-late',
        nickname: 'Late',
        nicknameKey: 'late',
        avatarId: 'fox',
      },
    });
    expect(late).toEqual({ ok: false, code: 'ROOM_CLOSED' });
  });

  it('refuses commands in a closed room', () => {
    const h = new Harness();
    const [a] = h.joinPlayers(2) as [string];
    h.command(h.displayActor(), { type: 'END_ROOM', payload: {} });
    expect(h.command(h.actor(a), { type: 'READY', payload: { ready: true } })).toEqual({
      ok: false,
      code: 'ROOM_CLOSED',
    });
  });
});

describe('entitlement changes', () => {
  it('notifies everyone and clamps rounds when a room is downgraded', () => {
    const h = new Harness({ tier: 'FULL' });
    const [a] = h.joinPlayers(2) as [string];
    h.command(h.actor(a), { type: 'SET_SETTINGS', payload: { rounds: 10 } });
    h.apply({ kind: 'ENTITLEMENT', tier: 'FREE', hostAccountId: null });
    expect(h.state.tier).toBe('FREE');
    expect(h.state.settings.rounds).toBe(6);
    expect(events(h, 'ENTITLEMENT_CHANGED').at(-1)).toEqual({ tier: 'FREE', reason: 'REVOKED' });
    h.apply({ kind: 'ENTITLEMENT', tier: 'FULL', hostAccountId: 'acc-1' });
    expect(h.state.hostAccountId).toBe('acc-1');
    expect(events(h, 'ENTITLEMENT_CHANGED').at(-1)).toEqual({ tier: 'FULL', reason: 'LINKED' });
  });

  it('is a no-op when nothing changes', () => {
    const h = new Harness({ tier: 'FULL' });
    const before = h.state;
    h.apply({ kind: 'ENTITLEMENT', tier: 'FULL', hostAccountId: null });
    expect(h.state).toBe(before);
  });
});
