import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhaseData } from '@quizparty/protocol';
import type { TestClient } from '../helpers/client';
import { closeParty, createParty } from '../helpers/party';
import { preRevealLeaks } from '../helpers/scan';
import {
  answerRound,
  componentSum,
  inPhase,
  lastDeltas,
  roomOf,
  say,
  startGame,
  toRound,
} from '../helpers/rounds';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';
import { waitUntil } from '../helpers/wait';

/**
 * ADR-0023 over real sockets: Cover, Pot and Duel in RISK_PICK, Stake Cap, Cut and Blind Clock in
 * SABOTAGE_PICK; what each phone is told, what the TV is told, and what reaches the audit trail.
 */
const CONFIG = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 8,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    riskPickMs: 6000,
    sabotagePickMs: 6000,
    riskPickDecisionMs: 6000,
    answerMs: { STANDARD: 5000, SPEED: 5000, RISK: 5000, CROWD: 5000, FINAL: 5000 },
  },
  // No shield: it would absorb the first hit and hide what these tests look at.
  powers: { shieldPerGame: 0, sabotage: { maxPerRound: 3 } },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: CONFIG });
});
afterAll(async () => {
  await server.dispose();
});

const lastYou = (client: TestClient) => {
  const states = client.messages.filter((m) => m.type === 'PLAYER_STATE');
  const last = states.at(-1);
  if (!last || last.type !== 'PLAYER_STATE') throw new Error('no PLAYER_STATE yet');
  return last.payload.you;
};
const risk = (stake: 'SAFE' | 'RISK' | 'HIGH', extra: Record<string, unknown> = {}) => ({
  stake,
  doubleDown: false,
  ...extra,
});

/** Makes a three-player party and plays round 0 so everybody has points; stops in RISK_PICK of round 1. */
async function party3() {
  const party = await createParty(server, 3);
  await startGame(party, 8);
  await toRound(server, party, 1, ['correct', 'correct', 'correct']);
  return party;
}

describe('Cover and Pot over sockets', () => {
  it('Cover pays its fee and waives the loss; the pot splits between the right answers', async () => {
    const party = await party3();
    const [p0, p1, p2] = party.players as [TestClient, TestClient, TestClient];
    expect(await say(p0, 'COMMIT_RISK', risk('RISK', { cover: true, pot: true }))).toBe('OK');
    expect(await say(p1, 'COMMIT_RISK', risk('SAFE', { pot: true }))).toBe('OK');
    expect(await say(p2, 'COMMIT_RISK', risk('SAFE', { pot: true }))).toBe('OK');
    await answerRound(server, party, ['wrong', 'correct', 'correct']);

    const resolution = await party.display.next(
      (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'POWER_RESOLUTION',
      10_000,
      'POWER_RESOLUTION',
    );
    const data: PhaseData = (resolution as { payload: { data: PhaseData } }).payload.data;
    if (data.phase !== 'POWER_RESOLUTION') throw new Error('unexpected phase');
    expect(data.items).toContainEqual({
      kind: 'COVER',
      playerId: p0.playerId,
      outcome: 'INCORRECT',
      fee: 50,
      saved: 100,
    });
    expect(data.items).toContainEqual({
      kind: 'POT',
      playerIds: [p0.playerId, p1.playerId, p2.playerId],
      winnerIds: [p1.playerId, p2.playerId],
      size: 90,
      refunded: false,
    });
    await inPhase(server, party, 'SCORE_UPDATE', 1);
    const deltas = lastDeltas(server, party);
    expect(deltas[p0.playerId!]!.components).toEqual([
      { kind: 'COVER_FEE', points: -50 },
      { kind: 'POT', points: -30 },
    ]);
    // Points moved, none created.
    expect(componentSum(deltas, 'POT')).toBe(0);
    expect(deltas[p1.playerId!]!.components).toContainEqual({ kind: 'POT', points: 15 });

    // The audit trail keeps the new components.
    const game = await waitUntil(
      () =>
        server.db.db
          .selectFrom('games')
          .selectAll()
          .where('room_id', '=', party.created.roomId)
          .executeTakeFirst(),
      8_000,
      'the game row',
    );
    const row = await waitUntil(
      () =>
        server.db.db
          .selectFrom('score_deltas')
          .selectAll()
          .where('game_id', '=', game.id)
          .where('round_index', '=', 1)
          .where('player_id', '=', p0.playerId!)
          .executeTakeFirst(),
      8_000,
      'the persisted score delta',
    );
    expect(row.components).toEqual([
      { kind: 'COVER_FEE', points: -50 },
      { kind: 'POT', points: -30 },
    ]);
    const answer = await server.db.db
      .selectFrom('game_answers')
      .selectAll()
      .where('game_id', '=', game.id)
      .where('round_index', '=', 1)
      .where('player_id', '=', p0.playerId!)
      .executeTakeFirstOrThrow();
    expect(answer.stake).toBe('RISK');
    await closeParty(party);
  });

  it('tells nobody but the player what they anted or covered, before the reveal', async () => {
    const party = await party3();
    const [p0, p1, p2] = party.players as [TestClient, TestClient, TestClient];
    const mark = (c: TestClient) => c.messages.length;
    const before = new Map([party.display, p1, p2].map((c) => [c, mark(c)]));
    await say(p0, 'COMMIT_RISK', risk('RISK', { cover: true, pot: true }));
    await say(p1, 'COMMIT_RISK', risk('SAFE'));
    await say(p2, 'COMMIT_RISK', risk('SAFE'));
    await inPhase(server, party, 'ANSWERING', 1);
    expect(lastYou(p0).commitment).toMatchObject({ cover: true, pot: true });
    for (const client of [party.display, p1, p2]) {
      const seen = JSON.stringify(client.messages.slice(before.get(client)).map((m) => m.payload));
      expect(seen).not.toContain('"cover":true');
      expect(seen).not.toContain('"pot":true');
      expect(seen).not.toContain(p0.playerId!.concat('","answer'));
    }
    await answerRound(server, party, ['wrong', 'correct', 'correct']);
    await closeParty(party);
  });
});

describe('Duel over sockets', () => {
  it('is offered to the rival alone; accepting moves 80, declining moves nothing', async () => {
    const party = await party3();
    const [p0, p1, p2] = party.players as [TestClient, TestClient, TestClient];
    const mark = new Map([party.display, p0, p2].map((c) => [c, c.messages.length]));
    expect(await say(p0, 'COMMIT_RISK', risk('RISK', { duel: { targetId: p1.playerId } }))).toBe(
      'OK',
    );
    await waitUntil(() => lastYou(p1).duelInvites?.length, 5_000, 'the invite');
    expect(lastYou(p1).duelInvites).toEqual([{ challengerId: p0.playerId, answer: null }]);
    // the rest of the table learns nothing: no invite on p2, nothing naming anyone on the TV
    expect(lastYou(p2).duelInvites).toBeUndefined();
    for (const client of [party.display, p2]) {
      const seen = JSON.stringify(client.messages.slice(mark.get(client)).map((m) => m.payload));
      expect(seen).not.toContain('duelInvites');
      expect(seen).not.toContain('challengerId');
    }
    // the room does not move on while a connected rival still has to answer
    await say(p1, 'COMMIT_RISK', risk('SAFE'));
    await say(p2, 'COMMIT_RISK', risk('SAFE'));
    expect(roomOf(server, party).state.phase).toBe('RISK_PICK');
    expect(await say(p1, 'RESPOND_DUEL', { challengerId: p0.playerId, accept: true })).toBe('OK');
    await answerRound(server, party, ['correct', 'wrong', 'correct']);
    await inPhase(server, party, 'SCORE_UPDATE', 1);
    const deltas = lastDeltas(server, party);
    expect(componentSum(deltas, 'DUEL', p0.playerId!)).toBe(80);
    expect(componentSum(deltas, 'DUEL', p1.playerId!)).toBe(-80);
    expect(componentSum(deltas, 'DUEL')).toBe(0);

    // round 2: a second challenge, declined
    await inPhase(server, party, 'RISK_PICK', 2);
    expect(await say(p0, 'COMMIT_RISK', risk('SAFE', { duel: { targetId: p2.playerId } }))).toBe(
      'OK',
    );
    expect(await say(p2, 'RESPOND_DUEL', { challengerId: p0.playerId, accept: false })).toBe('OK');
    await say(p1, 'COMMIT_RISK', risk('SAFE'));
    await say(p2, 'COMMIT_RISK', risk('SAFE'));
    await answerRound(server, party, ['wrong', 'correct', 'correct']);
    await inPhase(server, party, 'SCORE_UPDATE', 2);
    expect(componentSum(lastDeltas(server, party), 'DUEL')).toBe(0);
    for (const client of [party.display, ...party.players])
      expect(preRevealLeaks(client)).toEqual([]);
    await closeParty(party);
  });
});

describe('the new sabotages over sockets', () => {
  /** Rounds 0 and 1 played so the scores differ (p2 last) and sabotage is open in round 2. */
  async function sabotageParty() {
    const party = await createParty(server, 3);
    await startGame(party, 8);
    await toRound(server, party, 2, ['correct', 'correct', 'wrong']);
    return party;
  }

  it('Stake Cap, Cut and Blind Clock land, are audited, and Stake Cap bites next round', async () => {
    const party = await sabotageParty();
    const [p0, p1, p2] = party.players as [TestClient, TestClient, TestClient];
    for (const c of party.players) c.send('COMMIT_RISK', risk('SAFE'));
    await inPhase(server, party, 'SABOTAGE_PICK', 2);
    const menu = party.display.messages
      .filter((m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'SABOTAGE_PICK')
      .at(-1);
    expect(JSON.stringify(menu)).toContain(
      '"offered":["JAM","SHUFFLE","FOG","LOCKOUT","POINT_TAX","STAKE_CAP","CUT","BLIND_CLOCK"]',
    );

    // the leader is out of reach for Cut, and a refusal spends nothing
    expect(
      await say(p2, 'COMMIT_SABOTAGE', { sabotage: { targetId: p0.playerId, effect: 'CUT' } }),
    ).toBe('TARGET_INVALID');
    expect(
      await say(p0, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: p2.playerId, effect: 'STAKE_CAP' },
      }),
    ).toBe('OK');
    expect(
      await say(p1, 'COMMIT_SABOTAGE', {
        sabotage: { targetId: p0.playerId, effect: 'BLIND_CLOCK' },
      }),
    ).toBe('OK');
    expect(
      await say(p2, 'COMMIT_SABOTAGE', { sabotage: { targetId: p1.playerId, effect: 'CUT' } }),
    ).toBe('OK');
    await inPhase(server, party, 'ANSWERING', 2);
    expect(lastYou(p0).effects).toMatchObject({ blindClock: true, jamMs: 0 });
    expect(lastYou(p0).hits).toEqual([{ effect: 'BLIND_CLOCK', blocked: false }]);
    expect(lastYou(p2).hits).toEqual([{ effect: 'STAKE_CAP', blocked: false }]);
    expect(lastYou(p1).hits).toEqual([{ effect: 'CUT', blocked: false }]);
    expect(lastYou(p1).effects?.blindClock).toBeUndefined();
    await answerRound(server, party, ['correct', 'correct', 'wrong']);
    await inPhase(server, party, 'SCORE_UPDATE', 2);
    const deltas = lastDeltas(server, party);
    expect(componentSum(deltas, 'CUT', p1.playerId!)).toBe(-30);
    expect(componentSum(deltas, 'CUT', p2.playerId!)).toBe(30);

    // round 3: the capped player cannot take HIGH; the others can
    await inPhase(server, party, 'RISK_PICK', 3);
    await waitUntil(() => lastYou(p2).powers?.stakeCap === 'RISK', 5_000, 'the cap');
    expect(await say(p2, 'COMMIT_RISK', risk('HIGH'))).toBe('STAKE_INVALID');
    expect(await say(p2, 'COMMIT_RISK', risk('RISK'))).toBe('OK');
    expect(await say(p0, 'COMMIT_RISK', risk('HIGH'))).toBe('OK');
    expect(lastYou(p0).powers?.stakeCap).toBeUndefined();
    await say(p1, 'COMMIT_RISK', risk('SAFE'));
    await answerRound(server, party);

    // the audit trail has all three effects (migration 0008 widened the constraint)
    const game = await waitUntil(
      () =>
        server.db.db
          .selectFrom('games')
          .selectAll()
          .where('room_id', '=', party.created.roomId)
          .executeTakeFirst(),
      8_000,
      'the game row',
    );
    const events = await waitUntil(
      async () => {
        const rows = await server.db.db
          .selectFrom('sabotage_events')
          .selectAll()
          .where('game_id', '=', game.id)
          .execute();
        return rows.length >= 3 ? rows : null;
      },
      8_000,
      'the sabotage audit',
    );
    expect(events.map((e) => e.effect).sort()).toEqual(['BLIND_CLOCK', 'CUT', 'STAKE_CAP']);
    await closeParty(party);
  });
});
