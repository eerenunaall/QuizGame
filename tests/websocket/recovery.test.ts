import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import type { ServerMessage } from '@quizparty/protocol';
import { PgRoomStore } from '../../apps/realtime/src/rooms/store';
import { systemClock } from '../../apps/realtime/src/util/clock';
import { TestClient } from '../helpers/client';
import { seedTestBank } from '../helpers/bank';
import { FAST_GAME_CONFIG, createRoom, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
  await seedTestBank(database.db);
});
afterAll(async () => {
  await database.drop();
});

const SLOW_ANSWER = {
  ...FAST_GAME_CONFIG,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    answerMs: { STANDARD: 6000, SPEED: 6000, RISK: 6000, CROWD: 6000, FINAL: 6000 },
  },
};

const answering = (m: ServerMessage) =>
  m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'ANSWERING';

describe('process crash and restart (ADR-0006)', () => {
  it('recovers the running room from the durable log, freezes the clock and finishes the game', async () => {
    const a = await startServer({ database, gameConfig: SLOW_ANSWER });
    const created = await createRoom(a);
    const display = await TestClient.connect(a.wsUrl);
    await display.attachDisplay(created);
    const p1 = await TestClient.connect(a.wsUrl);
    await p1.join(a.wsUrl, created.code, 'Bir');
    const p2 = await TestClient.connect(a.wsUrl);
    await p2.join(a.wsUrl, created.code, 'Iki');
    p1.send('START_GAME', {});
    const entered = (await p2.next(answering, 8_000, 'ANSWERING')) as Extract<
      ServerMessage,
      { type: 'PHASE_ENTERED' }
    >;
    const question = entered.payload.data as Extract<
      typeof entered.payload.data,
      { phase: 'ANSWERING' }
    >;
    p1.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: question.options[0]!.optionId,
    });
    await p1.nextOfType('ANSWER_ACCEPTED'); // acknowledged ⇒ durable
    const deadlineBefore = question.answerDeadlineAt;

    await a.built.crash(); // process dies: nothing flushed, no lease released
    await new Promise((resolve) => setTimeout(resolve, 700)); // outage

    const b = await startServer({ database, gameConfig: SLOW_ANSWER });
    try {
      const recovered = b.built.manager.getByCode(created.code);
      expect(recovered, 'room must be back after restart').toBeDefined();
      expect(recovered!.state.phase).toBe('ANSWERING');

      // everyone reconnects with the tokens they already hold
      const back1 = await TestClient.connect(b.wsUrl);
      Object.assign(back1, {
        sessionId: p1.sessionId,
        roomId: created.roomId,
        token: p1.token,
        sequence: p1.sequence + 100,
      });
      const view1 = await back1.reconnect();
      expect(view1.phase).toBe('ANSWERING');
      expect(view1.you?.answer?.optionId).toBe(question.options[0]!.optionId); // the acked answer survived
      const shift =
        (view1.phaseData as { answerDeadlineAt: number }).answerDeadlineAt - deadlineBefore;
      expect(shift).toBeGreaterThanOrEqual(600); // players keep exactly the time they had left
      expect(shift).toBeLessThan(5_000);

      const back2 = await TestClient.connect(b.wsUrl);
      Object.assign(back2, {
        sessionId: p2.sessionId,
        roomId: created.roomId,
        token: p2.token,
        sequence: p2.sequence + 100,
      });
      await back2.reconnect();
      const backDisplay = await TestClient.connect(b.wsUrl);
      Object.assign(backDisplay, {
        sessionId: created.display.sessionId,
        roomId: created.roomId,
        token: display.token,
        sequence: display.sequence + 100,
      });
      await backDisplay.reconnect();

      back1.send('SUBMIT_ANSWER', {
        questionId: question.questionId,
        optionId: question.options[1]!.optionId,
      });
      expect((await back1.nextOfType('ANSWER_REJECTED')).payload.code).toBe('ANSWER_DUPLICATE');
      back2.send('SUBMIT_ANSWER', {
        questionId: question.questionId,
        optionId: question.options[1]!.optionId,
      });
      await back2.nextOfType('ANSWER_ACCEPTED');

      const autoplay = (client: TestClient) =>
        client.subscribe((m) => {
          if (m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'ANSWERING') {
            const data = m.payload.data;
            client.send('SUBMIT_ANSWER', {
              questionId: data.questionId,
              optionId: data.options[0]!.optionId,
            });
          }
        });
      autoplay(back1);
      autoplay(back2);
      await backDisplay.waitForPhase('RESULTS', 20_000);

      const rows = await b.db.db
        .selectFrom('room_events')
        .select('seq')
        .where('room_id', '=', created.roomId)
        .execute();
      expect(rows.length).toBeGreaterThan(10);
      const seqs = rows.map((r) => r.seq).sort((x, y) => x - y);
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1)); // gap-free log
      await Promise.all([back1.close(), back2.close(), backDisplay.close()]);
    } finally {
      await b.stop();
    }
  });

  it('a graceful restart hands rooms over immediately', async () => {
    const a = await startServer({ database, gameConfig: SLOW_ANSWER });
    const created = await createRoom(a);
    const p = await TestClient.connect(a.wsUrl);
    await p.join(a.wsUrl, created.code, 'Misafir');
    await a.stop();
    expect(p.closeInfo?.code).toBe(1012); // "service restart": clients retry at once

    const b = await startServer({ database, gameConfig: SLOW_ANSWER });
    try {
      expect(b.built.manager.getByCode(created.code)?.state.playerOrder).toHaveLength(1);
      const back = await TestClient.connect(b.wsUrl);
      Object.assign(back, {
        sessionId: p.sessionId,
        roomId: created.roomId,
        token: p.token,
        sequence: p.sequence + 10,
      });
      const view = await back.reconnect();
      expect(view.players.map((x) => x.nickname)).toEqual(['Misafir']);
      await back.close();
    } finally {
      await b.stop();
    }
  });

  it('closes rooms whose outage exceeded the recoverable limit, keeping them restorable for audit', async () => {
    const a = await startServer({ database, gameConfig: SLOW_ANSWER });
    const created = await createRoom(a);
    await a.built.crash();
    await database.db
      .updateTable('rooms')
      .set({
        last_heartbeat_at: new Date(Date.now() - 3_600_000),
        last_event_at: new Date(Date.now() - 3_600_000),
      })
      .where('id', '=', created.roomId)
      .execute();
    const b = await startServer({ database, gameConfig: SLOW_ANSWER });
    try {
      await waitUntil(
        async () => {
          const row = await database.db
            .selectFrom('rooms')
            .select(['status', 'close_reason'])
            .where('id', '=', created.roomId)
            .executeTakeFirst();
          return row?.status === 'CLOSED' ? row : null;
        },
        5_000,
        'interrupted room to be closed',
      );
      const row = await database.db
        .selectFrom('rooms')
        .select('close_reason')
        .where('id', '=', created.roomId)
        .executeTakeFirstOrThrow();
      expect(row.close_reason).toBe('INTERRUPTED');
    } finally {
      await b.stop();
    }
  });
});

describe('ownership fencing (ADR-0003)', () => {
  it('a stale owner cannot append once someone else holds the room', async () => {
    const owner: TestServer = await startServer({
      database,
      gameConfig: SLOW_ANSWER,
      env: { INSTANCE_ID: 'owner-a' },
    });
    const created = await createRoom(owner);
    const p = await TestClient.connect(owner.wsUrl);
    await p.join(owner.wsUrl, created.code, 'Fence');

    const intruder = new PgRoomStore(database.db, 'owner-b', 2000, systemClock);
    expect(
      await intruder.appendEvent(created.roomId, 999, Date.now(), {
        kind: 'TICK',
        at: 1,
        entropy: 'e',
      }),
    ).toBe('FENCED');

    // another instance takes the room over: the old owner's next write is fenced and it lets go
    await database.db
      .updateTable('rooms')
      .set({ owner_instance_id: 'owner-b' })
      .where('id', '=', created.roomId)
      .execute();
    p.send('READY', { ready: true });
    await waitUntil(() => p.closeInfo !== null, 3_000, 'fenced owner to drop connections');
    expect(p.closeInfo?.code).toBe(1012);
    expect(owner.built.manager.get(created.roomId)).toBeUndefined();
    await owner.stop();
  });
});
