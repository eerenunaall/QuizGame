import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@quizparty/protocol';
import { TestClient } from '../helpers/client';
import {
  FAST_GAME_CONFIG,
  createRoom,
  startServer,
  type CreatedRoom,
  type TestServer,
} from '../helpers/server';
import { waitUntil } from '../helpers/wait';

let server: TestServer;
beforeAll(async () => {
  server = await startServer({
    gameConfig: {
      ...FAST_GAME_CONFIG,
      timings: {
        ...FAST_GAME_CONFIG.timings,
        leaderGraceMs: 300,
        answerMs: { STANDARD: 4000, SPEED: 4000, RISK: 4000, CROWD: 4000, FINAL: 4000 },
      },
    },
  });
});
afterAll(async () => {
  await server.dispose();
});

async function lobby(
  playerCount = 2,
): Promise<{ created: CreatedRoom; display: TestClient; players: TestClient[] }> {
  const created = await createRoom(server);
  const display = await TestClient.connect(server.wsUrl);
  await display.attachDisplay(created);
  const players: TestClient[] = [];
  for (let i = 0; i < playerCount; i++) {
    const client = await TestClient.connect(server.wsUrl);
    await client.join(server.wsUrl, created.code, `Oyuncu${i + 1}`);
    players.push(client);
  }
  return { created, display, players };
}

const answering = (message: ServerMessage) =>
  message.type === 'PHASE_ENTERED' && message.payload.data.phase === 'ANSWERING';

describe('phone reconnect', () => {
  it('restores a mid-question session with the locked answer intact and rotates the token', async () => {
    const { created, display, players } = await lobby(2);
    const [a, b] = players as [TestClient, TestClient];
    a.send('START_GAME', {});
    const entered = (await a.next(answering, 8_000, 'ANSWERING')) as Extract<
      ServerMessage,
      { type: 'PHASE_ENTERED' }
    >;
    const data = entered.payload.data as Extract<
      typeof entered.payload.data,
      { phase: 'ANSWERING' }
    >;
    b.send('SUBMIT_ANSWER', { questionId: data.questionId, optionId: data.options[2]!.optionId });
    await b.nextOfType('ANSWER_ACCEPTED');

    const oldToken = b.token!;
    b.drop(); // phone loses signal: no close handshake
    const status = await display.next(
      (m) =>
        m.type === 'PLAYER_STATUS' &&
        m.payload.playerId === b.playerId &&
        m.payload.connection === 'DISCONNECTED',
      3_000,
      'disconnect notice',
    );
    expect(status.type).toBe('PLAYER_STATUS');

    const back = await TestClient.connect(server.wsUrl);
    Object.assign(back, {
      sessionId: b.sessionId,
      roomId: b.roomId,
      token: oldToken,
      sequence: b.sequence,
    });
    const view = await back.reconnect();
    expect(back.token).not.toBe(oldToken);
    expect(view.phase).toBe('ANSWERING');
    expect(view.you?.answer).toMatchObject({
      optionId: data.options[2]!.optionId,
      questionId: data.questionId,
    });
    expect(view.phaseData).toMatchObject({ phase: 'ANSWERING', answeredPlayerIds: [b.playerId] });
    await display.next(
      (m) =>
        m.type === 'PLAYER_STATUS' &&
        m.payload.playerId === b.playerId &&
        m.payload.connection === 'CONNECTED',
      3_000,
      'reconnect notice',
    );
    // the second answer attempt is a duplicate: the locked answer survived the reconnect
    back.send('SUBMIT_ANSWER', {
      questionId: data.questionId,
      optionId: data.options[0]!.optionId,
    });
    expect((await back.nextOfType('ANSWER_REJECTED')).payload.code).toBe('ANSWER_DUPLICATE');
    expect(created.roomId).toBe(view.roomId);
    await Promise.all([display.close(), a.close(), back.close()]);
  });

  it('accepts the previous token once (lost response) and revokes the session when an old token resurfaces', async () => {
    const { display, players } = await lobby(2);
    const [, b] = players as [TestClient, TestClient];
    const original = b.token!;
    b.drop();

    // first reconnect succeeds, but its response is "lost": the client still holds `original`
    const first = await TestClient.connect(server.wsUrl);
    Object.assign(first, {
      sessionId: b.sessionId,
      roomId: b.roomId,
      token: original,
      sequence: b.sequence,
    });
    await first.reconnect();
    const rotatedOnce = first.token!;
    first.drop();

    const second = await TestClient.connect(server.wsUrl);
    Object.assign(second, {
      sessionId: b.sessionId,
      roomId: b.roomId,
      token: original,
      sequence: first.sequence + 10,
    });
    await second.reconnect(); // previous token is still valid inside its grace window
    expect(second.token).not.toBe(rotatedOnce);

    // outside the grace window an old token is evidence of theft: revoke the session
    await server.db.db
      .updateTable('room_sessions')
      .set({ prev_valid_until: new Date(Date.now() - 1_000) })
      .where('id', '=', b.sessionId!)
      .execute();
    const thief = await TestClient.connect(server.wsUrl);
    Object.assign(thief, {
      sessionId: b.sessionId,
      roomId: b.roomId,
      token: original,
      sequence: 1,
    });
    thief.send('RECONNECT', { reconnectToken: original, client: { kind: 'WEB', version: 't' } });
    expect((await thief.nextOfType('ERROR')).payload.code).toBe('SESSION_REVOKED');

    const revoked = await second.nextOfType('SESSION_REVOKED');
    expect(revoked.payload.reason).toBe('TOKEN_REUSE');
    // blast radius: this slot only. The legitimate holder must rejoin; the room itself is fine.
    const late = await TestClient.connect(server.wsUrl);
    Object.assign(late, {
      sessionId: b.sessionId,
      roomId: b.roomId,
      token: second.token,
      sequence: 5,
    });
    late.send('RECONNECT', { reconnectToken: second.token, client: { kind: 'WEB', version: 't' } });
    expect((await late.nextOfType('ERROR')).payload.code).toBe('SESSION_EXPIRED');
    const events = await server.db.db
      .selectFrom('security_events')
      .select('kind')
      .where('session_id', '=', b.sessionId!)
      .execute();
    expect(events.map((e) => e.kind)).toContain('RECONNECT_TOKEN_REUSE');
    expect(server.built.manager.get(b.roomId!)?.state.phase).toBe('LOBBY');
    await Promise.all([display.close(), players[0]!.close()]);
  });

  it('lets a newer connection supersede the older one for the same session', async () => {
    const { display, players } = await lobby(2);
    const [a] = players as [TestClient, TestClient];
    const twin = await TestClient.connect(server.wsUrl);
    Object.assign(twin, {
      sessionId: a.sessionId,
      roomId: a.roomId,
      token: a.token,
      sequence: a.sequence + 5,
    });
    await twin.reconnect();
    expect((await a.nextOfType('SESSION_SUPERSEDED')).type).toBe('SESSION_SUPERSEDED');
    await a.idle(100);
    expect(a.closeInfo?.code).toBe(4001);
    await Promise.all([display.close(), twin.close(), players[1]!.close()]);
  });

  it('keeps a kicked player out: the session is revoked and cannot reconnect', async () => {
    const { display, players } = await lobby(3);
    const [leader, , victim] = players as [TestClient, TestClient, TestClient];
    leader.send('KICK_PLAYER', { playerId: victim.playerId });
    await leader.nextOfType('ACK');
    expect((await victim.nextOfType('SESSION_REVOKED')).payload.reason).toBe('KICKED');
    await victim.idle(100);
    const retry = await TestClient.connect(server.wsUrl);
    Object.assign(retry, {
      sessionId: victim.sessionId,
      roomId: victim.roomId,
      token: victim.token,
      sequence: 50,
    });
    retry.send('RECONNECT', {
      reconnectToken: victim.token,
      client: { kind: 'WEB', version: 't' },
    });
    expect((await retry.nextOfType('ERROR')).payload.code).toBe('SESSION_EXPIRED');
    await Promise.all([display.close(), ...players.slice(0, 2).map((p) => p.close())]);
  });

  it('refuses reconnects into a closed room', async () => {
    const { created, display, players } = await lobby(2);
    const [a] = players as [TestClient, TestClient];
    display.send('END_ROOM', {});
    await display.nextOfType('ACK');
    await a.waitForPhase('ROOM_CLOSED', 3_000);
    await waitUntil(() => !server.built.manager.get(created.roomId), 3_000, 'room removal');
    const late = await TestClient.connect(server.wsUrl);
    Object.assign(late, { sessionId: a.sessionId, roomId: a.roomId, token: a.token, sequence: 70 });
    late.send('RECONNECT', { reconnectToken: a.token, client: { kind: 'WEB', version: 't' } });
    const error = await late.nextOfType('ERROR');
    expect(['SESSION_EXPIRED', 'ROOM_CLOSED']).toContain(error.payload.code);
  });
});

describe('host recovery', () => {
  it('survives a display refresh in the middle of a game without resetting the match', async () => {
    const { created, display, players } = await lobby(2);
    const [a] = players as [TestClient, TestClient];
    a.send('START_GAME', {});
    await display.next(answering, 8_000, 'ANSWERING');
    const phaseAtDrop = server.built.manager.get(created.roomId)!.state.game!.roundIndex;
    const roomView = await (async () => {
      display.drop();
      const refreshed = await TestClient.connect(server.wsUrl);
      Object.assign(refreshed, {
        sessionId: created.display.sessionId,
        roomId: created.roomId,
        token: display.token,
        sequence: display.sequence + 1,
      });
      return { view: await refreshed.reconnect(), client: refreshed };
    })();
    expect(roomView.view.game?.roundIndex).toBe(phaseAtDrop);
    expect(roomView.view.displayConnected).toBe(true);
    await roomView.client.waitForPhase('RESULTS', 15_000);
    await roomView.client.close();
    await Promise.all(players.map((p) => p.close()));
  });

  it('moves leadership to the next connected player after the grace period', async () => {
    const { display, players } = await lobby(3);
    const [leader, next] = players as [TestClient, TestClient, TestClient];
    leader.drop();
    const changed = await next.next(
      (m) => m.type === 'LEADER_CHANGED' && m.payload.playerId === next.playerId,
      4_000,
      'leader migration',
    );
    expect(changed.type).toBe('LEADER_CHANGED');
    next.send('SET_SETTINGS', { rounds: 4 });
    await next.nextOfType('ACK');
    await Promise.all([display.close(), ...players.slice(1).map((p) => p.close())]);
  });
});
