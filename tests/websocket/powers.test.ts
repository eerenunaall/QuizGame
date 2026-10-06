import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhaseData, ServerMessage } from '@quizparty/protocol';
import type { TestClient } from '../helpers/client';
import { closeParty, createParty, type Party } from '../helpers/party';
import { correctOptionId, liveRoom } from '../helpers/oracle';
import { preRevealLeaks } from '../helpers/scan';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * Stakes, Double Down, 50/50 and sabotage over real sockets: what each phone is told, what it is
 * not, and what ends up in the audit trail (ADR-0007, ADR-0010).
 */
const POWER_GAME = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 6,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    prepQuickMs: 4000,
    prepDecisionMs: 4000,
    answerMs: { STANDARD: 4000, SPEED: 4000, RISK: 4000, CROWD: 4000, FINAL: 4000 },
  },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: POWER_GAME });
});
afterAll(async () => {
  await server.dispose();
});

type Entered = Extract<ServerMessage, { type: 'PHASE_ENTERED' }>;
const dataOf = (message: Entered): PhaseData => message.payload.data;

const you = (client: TestClient) => {
  const states = client.messages.filter((m) => m.type === 'PLAYER_STATE');
  const last = states.at(-1);
  if (!last || last.type !== 'PLAYER_STATE') throw new Error('no PLAYER_STATE yet');
  return last.payload.you;
};

async function nextPlayerState(
  client: TestClient,
  match: (state: ReturnType<typeof you>) => boolean,
) {
  return client.next(
    (m) => m.type === 'PLAYER_STATE' && match(m.payload.you),
    5_000,
    'a matching PLAYER_STATE',
  );
}

const commit = (
  client: TestClient,
  choice: {
    stake?: 'SAFE' | 'RISK' | 'HIGH' | 'ALL_IN';
    doubleDown?: boolean;
    sabotage?: {
      targetId: string;
      effect: 'JAM' | 'SHUFFLE' | 'FOG' | 'LOCKOUT' | 'POINT_TAX';
    } | null;
  } = {},
) =>
  client.send('COMMIT_PREP', {
    stake: choice.stake ?? 'SAFE',
    doubleDown: choice.doubleDown ?? false,
    sabotage: choice.sabotage ?? null,
  });

async function everyone<T>(party: Party, run: (client: TestClient, index: number) => Promise<T>) {
  return Promise.all(party.players.map(run));
}

describe('a powered game over real WebSockets', () => {
  it('plays stakes, Double Down, 50/50 and sabotage, with the right people told the right things', async () => {
    const party = await createParty(server, 3);
    const [p0, p1, p2] = party.players as [TestClient, TestClient, TestClient];
    const roomId = party.created.roomId;
    party.leader.send('SET_SETTINGS', { rounds: 6 });
    await party.leader.nextOfType('ACK');
    party.leader.send('START_GAME', {});

    const answerAll = async (picks: ('correct' | 'wrong' | null)[]) => {
      const entered = await everyone(party, (client) => client.waitForPhase('ANSWERING', 8_000));
      const correct = correctOptionId(server, roomId);
      const live = liveRoom(server, roomId).state.game!.round!.question!;
      const wrong = live.options.find((o) => o.optionId !== correct)!.optionId;
      entered.forEach((message, i) => {
        const data = dataOf(message);
        if (data.phase !== 'ANSWERING' || picks[i] === null) return;
        party.players[i]!.send('SUBMIT_ANSWER', {
          questionId: data.questionId,
          optionId: picks[i] === 'correct' ? correct : wrong,
        });
      });
    };

    // ── Round 1: p0 goes HIGH and doubles down; the others play safe.
    await everyone(party, (client) => client.waitForPhase('QUESTION_PREP'));
    const prep = await party.display.waitForPhase('QUESTION_PREP');
    expect(dataOf(prep)).toMatchObject({
      riskLadder: [
        { tier: 'SAFE', multiplier: 1, loss: 0 },
        { tier: 'RISK', multiplier: 2, loss: 100 },
        { tier: 'HIGH', multiplier: 3, loss: 200 },
      ],
      doubleDownEnabled: true,
      sabotageEnabled: false,
      committedCount: 0,
      eligibleCount: 3,
    });
    commit(p0, { stake: 'HIGH', doubleDown: true });
    await nextPlayerState(p0, (s) => s.commitment?.stake === 'HIGH');
    expect(you(p0).powers).toMatchObject({ doubleDown: 1 });
    commit(p1);
    commit(p2);
    await answerAll(['correct', 'wrong', 'correct']);

    const resolution = await party.display.waitForPhase('POWER_RESOLUTION', 8_000);
    expect(dataOf(resolution)).toMatchObject({
      items: [
        { kind: 'STAKE', playerId: p0.playerId, tier: 'HIGH', outcome: 'CORRECT' },
        { kind: 'DOUBLE_DOWN', playerId: p0.playerId, outcome: 'CORRECT' },
      ],
    });
    const score = await party.display.waitForPhase('SCORE_UPDATE', 8_000);
    const scoreData = dataOf(score);
    if (scoreData.phase !== 'SCORE_UPDATE') throw new Error('unexpected phase');
    const mine = scoreData.deltas.find((d) => d.playerId === p0.playerId)!;
    expect(mine.components.map((c) => c.kind)).toEqual(
      expect.arrayContaining(['BASE', 'STAKE', 'DOUBLE_DOWN']),
    );
    expect(mine.delta).toBeGreaterThan(
      scoreData.deltas.find((d) => d.playerId === p2.playerId)!.delta * 3,
    );

    // ── Round 2: p1 uses 50/50; nobody else is told.
    await everyone(party, (client) => client.waitForPhase('QUESTION_PREP'));
    party.players.forEach((client) => commit(client));
    const answering = await everyone(party, (client) => client.waitForPhase('ANSWERING', 8_000));
    p1.send('USE_FIFTY_FIFTY', {});
    const used = await nextPlayerState(p1, (s) => s.fiftyFifty !== null);
    const keep = you(p1).fiftyFifty!.keep;
    expect(keep).toHaveLength(2);
    expect(keep).toContain(correctOptionId(server, roomId));
    const removed = liveRoom(server, roomId).state.game!.round!.question!.options.find(
      (o) => !keep.includes(o.optionId),
    )!;
    const data = dataOf(answering[1]!);
    if (data.phase !== 'ANSWERING') throw new Error('unexpected phase');
    p1.send('SUBMIT_ANSWER', { questionId: data.questionId, optionId: removed.optionId });
    const rejected = await p1.nextOfType('ANSWER_REJECTED');
    expect(rejected.payload.code).toBe('OPTION_INVALID');
    p1.send('SUBMIT_ANSWER', { questionId: data.questionId, optionId: keep[0] });
    expect(used.type).toBe('PLAYER_STATE');
    for (const other of [p0, p2]) {
      for (const message of other.messages) {
        if (message.type === 'PLAYER_STATE') expect(message.payload.you.fiftyFifty).toBeNull();
      }
    }
    // The other two answer so the round can close early.
    for (const [i, client] of [p0, p2].entries()) {
      const d = dataOf(answering[i === 0 ? 0 : 2]!);
      if (d.phase === 'ANSWERING')
        client.send('SUBMIT_ANSWER', {
          questionId: d.questionId,
          optionId: correctOptionId(server, roomId),
        });
    }
    await party.display.waitForPhase('POWER_RESOLUTION', 8_000);
    await party.display.waitForPhase('SCORE_UPDATE', 8_000);

    // ── Round 3 (index 2): p1 sabotages p0. The shield blocks the first hit; p2 hears nothing.
    await everyone(party, (client) => client.waitForPhase('QUESTION_PREP'));
    const before = p2.messages.length;
    commit(p0);
    commit(p1, { sabotage: { targetId: p0.playerId!, effect: 'JAM' } });
    commit(p2);
    await nextPlayerState(p0, (s) => s.hits.length > 0);
    expect(you(p0).hits).toEqual([{ effect: 'JAM', blocked: true }]);
    expect(you(p0).powers).toMatchObject({ shield: 0 });
    expect(you(p1).powers).toMatchObject({ sabotageTokens: 0 });
    await answerAll(['correct', 'correct', 'correct']);
    // p2 was not involved: nothing about the attack reached it before the resolution screen.
    const uninvolved = p2.messages
      .slice(before)
      .filter((m) => !(m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'POWER_RESOLUTION'))
      .filter((m) => !(m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'SCORE_UPDATE'));
    const early = uninvolved.slice(
      0,
      uninvolved.findIndex((m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'REVEAL'),
    );
    expect(JSON.stringify(early)).not.toContain('JAM');
    expect(JSON.stringify(early)).not.toContain(p1.playerId!.concat('"actor'));

    const attack = await party.display.waitForPhase('POWER_RESOLUTION', 8_000);
    expect(dataOf(attack)).toMatchObject({
      items: [
        {
          kind: 'SABOTAGE',
          actorId: p1.playerId,
          targetId: p0.playerId,
          effect: 'JAM',
          blocked: true,
        },
      ],
    });
    await party.display.waitForPhase('SCORE_UPDATE', 8_000);

    // Finish the game with everyone answering.
    for (let round = 3; round < 6; round++) {
      await everyone(party, (client) => client.waitForPhase('QUESTION_PREP'));
      party.players.forEach((client) => commit(client, { stake: round === 5 ? 'RISK' : 'SAFE' }));
      await answerAll(['correct', 'correct', 'correct']);
      await party.display.waitForPhase(round === 5 ? 'RESULTS' : 'SCORE_UPDATE', 8_000);
    }

    // No frame before a reveal ever carried the answer, powers or not.
    for (const client of [party.display, ...party.players])
      expect(preRevealLeaks(client)).toEqual([]);

    // The audit trail has every stake, Double Down, 50/50 and sabotage.
    const game = await waitUntil(
      async () => {
        const row = await server.db.db
          .selectFrom('games')
          .selectAll()
          .where('room_id', '=', roomId)
          .executeTakeFirst();
        return row?.status === 'FINISHED' ? row : null;
      },
      8_000,
      'game to be marked finished',
    );
    const answers = await server.db.db
      .selectFrom('game_answers')
      .selectAll()
      .where('game_id', '=', game.id)
      .execute();
    const row = (index: number, player: TestClient) =>
      answers.find((a) => a.round_index === index && a.player_id === player.playerId)!;
    expect(row(0, p0)).toMatchObject({ stake: 'HIGH', double_down: true, fifty_fifty: false });
    expect(row(1, p1)).toMatchObject({ stake: 'SAFE', fifty_fifty: true, double_down: false });
    expect(row(5, p2).stake).toBe('RISK');
    const sabotages = await server.db.db
      .selectFrom('sabotage_events')
      .selectAll()
      .where('game_id', '=', game.id)
      .execute();
    expect(sabotages).toEqual([
      expect.objectContaining({
        round_index: 2,
        actor_player_id: p1.playerId,
        target_player_id: p0.playerId,
        effect: 'JAM',
        blocked: true,
      }),
    ]);
    await closeParty(party);
  });
});
