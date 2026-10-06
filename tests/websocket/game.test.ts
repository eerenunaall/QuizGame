import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Phase } from '@quizparty/protocol';
import { TestClient } from '../helpers/client';
import { autoAnswer } from '../helpers/play';
import { preRevealLeaks } from '../helpers/scan';
import { createRoom, startServer, type CreatedRoom, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.dispose();
});

interface Party {
  created: CreatedRoom;
  display: TestClient;
  players: TestClient[];
  leader: TestClient;
}

async function party(playerCount = 3): Promise<Party> {
  const created = await createRoom(server);
  const display = await TestClient.connect(server.wsUrl);
  await display.attachDisplay(created);
  const players: TestClient[] = [];
  for (let i = 0; i < playerCount; i++) {
    const client = await TestClient.connect(server.wsUrl);
    await client.join(server.wsUrl, created.code, `Oyuncu${i + 1}`);
    players.push(client);
  }
  return { created, display, players, leader: players[0]! };
}

async function closeAll(p: Party): Promise<void> {
  await Promise.all([p.display.close(), ...p.players.map((c) => c.close())]);
}

describe('a complete game over real WebSockets', () => {
  it('plays 3 rounds, reveals only after lock, persists the audit trail and never leaks early', async () => {
    const p = await party(3);
    p.players.forEach((client, i) => autoAnswer(client, i));

    p.leader.send('START_GAME', {});
    await p.leader.nextOfType('ACK');
    const phases: Phase[] = [];
    p.display.subscribe((m) => {
      if (m.type === 'PHASE_ENTERED') phases.push(m.payload.data.phase);
    });
    await p.display.waitForPhase('RESULTS', 15_000);
    for (const client of p.players) await client.waitForPhase('RESULTS', 5_000);

    // phase order seen by the TV (LOBBY is before we subscribed): every round has the full cycle
    const round = [
      'ROUND_INTRO',
      'QUESTION_PREP',
      'QUESTION',
      'ANSWERING',
      'LOCKED',
      'REVEAL',
      'SCORE_UPDATE',
      'MICRO_INTERMISSION',
    ];
    const final = [
      'FINAL',
      'QUESTION_PREP',
      'QUESTION',
      'ANSWERING',
      'LOCKED',
      'REVEAL',
      'SCORE_UPDATE',
      'RESULTS',
    ];
    expect(phases).toEqual(['COUNTDOWN', ...round, ...round, ...final]);

    // REVEAL carries the answer; nothing before it did
    for (const client of [p.display, ...p.players]) expect(preRevealLeaks(client)).toEqual([]);
    const reveal = p.display.messages.find(
      (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'REVEAL',
    );
    expect(
      reveal &&
        reveal.type === 'PHASE_ENTERED' &&
        reveal.payload.data.phase === 'REVEAL' &&
        reveal.payload.data.correctOptionId,
    ).toBeTruthy();

    // every player got an acceptance per question, never a correctness hint in it
    for (const client of p.players) {
      const accepted = client.messages.filter((m) => m.type === 'ANSWER_ACCEPTED');
      expect(accepted).toHaveLength(3);
      for (const message of accepted)
        expect(Object.keys(message.payload).sort()).toEqual([
          'lockedAt',
          'messageId',
          'optionId',
          'questionId',
        ]);
    }

    // persisted audit trail
    const game = await waitUntil(
      async () => {
        const row = await server.db.db
          .selectFrom('games')
          .selectAll()
          .where('room_id', '=', p.created.roomId)
          .executeTakeFirst();
        return row?.status === 'FINISHED' ? row : null;
      },
      5_000,
      'game to be marked finished',
    );
    const rounds = await server.db.db
      .selectFrom('game_rounds')
      .select(['round_index', 'kind', 'question_id'])
      .where('game_id', '=', game.id)
      .orderBy('round_index')
      .execute();
    expect(rounds.map((r) => r.round_index)).toEqual([0, 1, 2]);
    expect(rounds[2]!.kind).toBe('FINAL');
    const answers = await server.db.db
      .selectFrom('game_answers')
      .selectAll()
      .where('game_id', '=', game.id)
      .execute();
    expect(answers).toHaveLength(9);
    const deltas = await server.db.db
      .selectFrom('score_deltas')
      .selectAll()
      .where('game_id', '=', game.id)
      .execute();
    expect(deltas).toHaveLength(9);
    const finals = await server.db.db
      .selectFrom('game_players')
      .selectAll()
      .where('game_id', '=', game.id)
      .execute();
    expect(finals).toHaveLength(3);
    for (const player of finals) {
      const total = deltas
        .filter((d) => d.player_id === player.player_id)
        .reduce((sum, d) => sum + d.delta, 0);
      expect(player.final_score).toBe(total);
      expect(deltas.filter((d) => d.player_id === player.player_id).at(-1)!.total_after).toBe(
        total,
      );
    }
    expect(finals.map((f) => f.final_rank).sort()).toEqual(expect.arrayContaining([1]));
    // question statistics were updated
    const used = await server.db.db
      .selectFrom('questions')
      .select('usage_count')
      .where(
        'id',
        'in',
        rounds.map((r) => r.question_id),
      )
      .execute();
    expect(used.every((q) => q.usage_count === 1)).toBe(true);
    await closeAll(p);
  });

  it('supports an immediate rematch with fresh scores', async () => {
    const p = await party(2);
    p.players.forEach((client, i) => autoAnswer(client, i));
    p.leader.send('START_GAME', {});
    await p.display.waitForPhase('RESULTS', 15_000);

    p.leader.send('REMATCH', {});
    const countdown = await p.display.next(
      (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'COUNTDOWN',
      5_000,
      'rematch countdown',
    );
    expect(countdown.type).toBe('PHASE_ENTERED');
    await p.display.waitForPhase('RESULTS', 15_000);
    const games = await server.db.db
      .selectFrom('games')
      .select('id')
      .where('room_id', '=', p.created.roomId)
      .execute();
    expect(games).toHaveLength(2);
    await closeAll(p);
  });
});

describe('answer validation over the wire', () => {
  async function inAnswering() {
    const p = await party(2);
    p.leader.send('START_GAME', {});
    const entered = await p.leader.waitForPhase('ANSWERING', 8_000);
    if (entered.payload.data.phase !== 'ANSWERING') throw new Error('unexpected phase');
    return { p, question: entered.payload.data };
  }

  it('accepts one answer, refuses duplicates, wrong questions and unknown options', async () => {
    const { p, question } = await inAnswering();
    const [a, b] = p.players as [TestClient, TestClient];
    a.send('SUBMIT_ANSWER', { questionId: 'nope', optionId: question.options[0]!.optionId });
    expect((await a.nextOfType('ANSWER_REJECTED')).payload.code).toBe('QUESTION_MISMATCH');
    a.send('SUBMIT_ANSWER', { questionId: question.questionId, optionId: 'AAAAAAAAAAAA' });
    expect((await a.nextOfType('ANSWER_REJECTED')).payload.code).toBe('OPTION_INVALID');
    a.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: question.options[1]!.optionId,
    });
    expect((await a.nextOfType('ANSWER_ACCEPTED')).payload.optionId).toBe(
      question.options[1]!.optionId,
    );
    a.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: question.options[2]!.optionId,
    });
    expect((await a.nextOfType('ANSWER_REJECTED')).payload.code).toBe('ANSWER_DUPLICATE');
    // the other player only learns that someone locked in, not what
    const locked = await b.nextOfType('ANSWER_LOCKED');
    expect(locked.payload).toMatchObject({ playerId: a.playerId, answeredCount: 1 });
    expect(JSON.stringify(locked.payload)).not.toContain(question.options[1]!.optionId);
    await closeAll(p);
  });

  it('rejects an answer that arrives after the lock', async () => {
    const { p, question } = await inAnswering();
    const [a] = p.players as [TestClient];
    await a.waitForPhase('LOCKED', 5_000);
    a.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: question.options[0]!.optionId,
    });
    expect((await a.nextOfType('ANSWER_REJECTED')).payload.code).toBe('ANSWER_LATE');
    await closeAll(p);
  });
});

describe('hostile clients', () => {
  it('ignores replayed frames: same bytes, older sequence', async () => {
    const p = await party(2);
    p.leader.send('START_GAME', {});
    const entered = await p.leader.waitForPhase('ANSWERING', 8_000);
    const question = entered.payload.data as Extract<
      typeof entered.payload.data,
      { phase: 'ANSWERING' }
    >;
    const [a, b] = p.players as [TestClient, TestClient];
    a.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: question.options[0]!.optionId,
    });
    await a.nextOfType('ANSWER_ACCEPTED');
    const captured = a.lastSentFrame!;
    await b.nextOfType('ANSWER_LOCKED');
    const before = b.messages.length;

    a.sendRaw(captured); // replay the captured packet verbatim
    expect((await a.nextOfType('ERROR')).payload.code).toBe('STALE_SEQUENCE');
    // an old sequence number with fresh content is refused as well
    a.send(
      'SUBMIT_ANSWER',
      { questionId: question.questionId, optionId: question.options[1]!.optionId },
      { sequence: 1 },
    );
    expect((await a.nextOfType('ERROR')).payload.code).toBe('STALE_SEQUENCE');
    await b.idle(150);
    expect(b.messages.slice(before).filter((m) => m.type === 'ANSWER_LOCKED')).toHaveLength(0);
    const events = await waitUntil(async () => {
      const rows = await server.db.db
        .selectFrom('security_events')
        .select('kind')
        .where('room_id', '=', p.created.roomId)
        .execute();
      return rows.some((r) => r.kind === 'STALE_SEQUENCE') ? rows : null;
    });
    expect(events.length).toBeGreaterThan(0);
    await closeAll(p);
  });

  it('refuses frames whose envelope claims another session or another room', async () => {
    const p = await party(2);
    const other = await party(1);
    const [a, b] = p.players as [TestClient, TestClient];
    a.send('READY', { ready: true }, { sessionId: b.sessionId });
    expect((await a.nextOfType('ERROR')).payload.code).toBe('FORBIDDEN');
    a.send('READY', { ready: true }, { roomId: other.created.roomId });
    expect((await a.nextOfType('ERROR')).payload.code).toBe('FORBIDDEN');
    expect(server.built.manager.get(p.created.roomId)?.state.players[b.playerId!]?.ready).toBe(
      false,
    );
    await closeAll(p);
    await closeAll(other);
  });

  it('a forged END_ROOM or START_GAME from a plain player changes nothing', async () => {
    const p = await party(3);
    const guest = p.players[2]!;
    guest.send('END_ROOM', {});
    expect((await guest.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    guest.send('START_GAME', {});
    expect((await guest.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    expect(server.built.manager.get(p.created.roomId)?.state.phase).toBe('LOBBY');
    await closeAll(p);
  });

  it('cannot talk to a room it never joined, and a stolen room code alone gives no authority', async () => {
    const p = await party(2);
    const outsider = await TestClient.connect(server.wsUrl);
    outsider.send('START_GAME', {}, { roomId: p.created.roomId, sessionId: p.leader.sessionId });
    expect((await outsider.nextOfType('ERROR')).payload.code).toBe('UNAUTHORIZED');
    outsider.send(
      'RECONNECT',
      { reconnectToken: 'x'.repeat(43), client: { kind: 'WEB', version: 't' } },
      { roomId: p.created.roomId, sessionId: p.leader.sessionId },
    );
    expect((await outsider.nextOfType('ERROR')).payload.code).toBe('SESSION_REVOKED');
    await closeAll(p);
    await outsider.close();
  });
});
