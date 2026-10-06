import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@quizparty/protocol';
import type { TestClient } from '../helpers/client';
import { liveRoom } from '../helpers/oracle';
import { closeParty, createParty, type Party } from '../helpers/party';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';

/**
 * Attacks on the power system (brief §26 ATTACK 5, GDD §7.6): replaying a sabotage, spamming it,
 * naming targets that are not there, committing late, and trying to learn what others hold.
 * The defender's ledger must not move and nothing private may reach the attacker.
 */
const CONFIG = {
  ...FAST_GAME_CONFIG,
  defaultRounds: 6,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    prepQuickMs: 5000,
    prepDecisionMs: 5000,
    answerMs: { STANDARD: 4000, SPEED: 4000, RISK: 4000, CROWD: 4000, FINAL: 4000 },
  },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: CONFIG });
});
afterAll(async () => {
  await server.dispose();
});

const safe = { stake: 'SAFE', doubleDown: false };

async function toRoundPrep(party: Party, index: number): Promise<void> {
  const room = () => liveRoom(server, party.created.roomId);
  party.leader.send('SET_SETTINGS', { rounds: 6 });
  await party.leader.nextOfType('ACK');
  party.leader.send('START_GAME', {});
  for (let round = 0; ; round++) {
    await Promise.all(party.players.map((c) => c.waitForPhase('QUESTION_PREP', 10_000)));
    if (round === index) return;
    // Fast-forward: everyone commits SAFE and answers at once, so each phase ends early.
    party.players.forEach((c) => c.send('COMMIT_PREP', { ...safe, sabotage: null }));
    const entered = await Promise.all(
      party.players.map((c) => c.waitForPhase('ANSWERING', 10_000)),
    );
    entered.forEach((message, i) => {
      if (message.payload.data.phase !== 'ANSWERING') return;
      party.players[i]!.send('SUBMIT_ANSWER', {
        questionId: message.payload.data.questionId,
        optionId: message.payload.data.options[0]!.optionId,
      });
    });
    await Promise.all(party.players.map((c) => c.waitForPhase('SCORE_UPDATE', 15_000)));
    expect(room().state.game!.round!.index).toBe(round);
  }
}

const ledgerOf = (party: Party, client: TestClient) =>
  liveRoom(server, party.created.roomId).state.game!.players[client.playerId!]!.powers;

describe('ATTACK 5 — replay a sabotage packet', () => {
  async function attacked() {
    const party = await createParty(server, 3);
    await toRoundPrep(party, 2);
    const [attacker, victim, bystander] = party.players as [TestClient, TestClient, TestClient];
    attacker.send('COMMIT_PREP', {
      ...safe,
      sabotage: { targetId: victim.playerId, effect: 'FOG' },
    });
    await attacker.nextOfType('ACK');
    return { party, attacker, victim, bystander, frame: attacker.lastSentFrame! };
  }

  it('rejects the verbatim replay and spends no second token', async () => {
    const { party, attacker, frame } = await attacked();
    expect(ledgerOf(party, attacker).tokens).toBe(0);
    attacker.sendRaw(frame);
    expect((await attacker.nextOfType('ERROR')).payload.code).toBe('STALE_SEQUENCE');
    const round = liveRoom(server, party.created.roomId).state.game!.round!;
    expect(Object.values(round.commitments).filter((c) => c.sabotage)).toHaveLength(1);
    await closeParty(party);
  });

  it('a re-sequenced replay (same message id) is refused as already committed', async () => {
    const { party, attacker, frame } = await attacked();
    const captured = JSON.parse(frame) as Record<string, unknown>;
    attacker.sendRaw(JSON.stringify({ ...captured, sequence: ++attacker.sequence }));
    const reply = await attacker.nextOfType('ERROR');
    expect(reply.payload.code).toBe('ALREADY_COMMITTED');
    expect(ledgerOf(party, attacker).tokens).toBe(0);
    expect(ledgerOf(party, attacker).lastSabotageRound).toBe(2);
    await closeParty(party);
  });

  it("cannot be replayed from another socket with the attacker's captured frame", async () => {
    const { party, bystander, frame, attacker } = await attacked();
    bystander.sendRaw(frame);
    const reply = await bystander.nextOfType('ERROR');
    expect(['FORBIDDEN', 'UNAUTHORIZED', 'STALE_SEQUENCE', 'INVALID_STATE']).toContain(
      reply.payload.code,
    );
    expect(
      liveRoom(server, party.created.roomId).state.game!.round!.commitments[bystander.playerId!],
    ).toBeUndefined();
    expect(ledgerOf(party, bystander).tokens).toBe(1); // untouched
    expect(ledgerOf(party, attacker).tokens).toBe(0);
    await closeParty(party);
  });

  it('replayed in a later round it is just another sabotage: no token, no cooldown bypass', async () => {
    const { party, attacker, victim, bystander, frame } = await attacked();
    const captured = JSON.parse(frame) as Record<string, unknown>;
    // The others commit, round 3 (index 2) plays out, and round 4's preparation opens.
    victim.send('COMMIT_PREP', { ...safe, sabotage: null });
    bystander.send('COMMIT_PREP', { ...safe, sabotage: null });
    await Promise.all(party.players.map((c) => c.waitForPhase('QUESTION_PREP', 20_000)));
    const room = liveRoom(server, party.created.roomId);
    expect(room.state.game!.round!.index).toBe(3);
    attacker.sendRaw(JSON.stringify({ ...captured, sequence: ++attacker.sequence }));
    const reply = await attacker.next(
      (m) => m.type === 'ERROR' || m.type === 'ACK',
      3_000,
      'a reply',
    );
    expect(reply.type).toBe('ERROR');
    if (reply.type === 'ERROR') expect(reply.payload.code).toBe('POWER_UNAVAILABLE'); // no token left
    expect(room.state.game!.round!.commitments[attacker.playerId!]).toBeUndefined();
    expect(ledgerOf(party, attacker)).toMatchObject({ tokens: 0, lastSabotageRound: 2 });
    await closeParty(party);
  });
});

describe('sabotage abuse', () => {
  it('refuses forged targets, forged effects and smuggled fields without spending anything', async () => {
    const party = await createParty(server, 3);
    await toRoundPrep(party, 2);
    const [attacker, victim] = party.players as [TestClient, TestClient, TestClient];
    const hostile: [string, unknown, string][] = [
      [
        'yourself',
        { ...safe, sabotage: { targetId: attacker.playerId, effect: 'JAM' } },
        'TARGET_INVALID',
      ],
      [
        'a stranger',
        { ...safe, sabotage: { targetId: 'nobody-here', effect: 'JAM' } },
        'TARGET_INVALID',
      ],
      [
        'the TV',
        { ...safe, sabotage: { targetId: party.created.display.sessionId, effect: 'JAM' } },
        'TARGET_INVALID',
      ],
      [
        'a lockout without a joker',
        { ...safe, sabotage: { targetId: victim.playerId, effect: 'LOCKOUT' } },
        'POWER_UNAVAILABLE',
      ],
      [
        'the excluded NOISE effect',
        { ...safe, sabotage: { targetId: victim.playerId, effect: 'NOISE' } },
        'INVALID_MESSAGE',
      ],
      [
        'a smuggled strength',
        { ...safe, sabotage: { targetId: victim.playerId, effect: 'JAM', jamMs: 0 } },
        'INVALID_MESSAGE',
      ],
      ['a smuggled shield override', { ...safe, shield: false, sabotage: null }, 'INVALID_MESSAGE'],
      [
        'a negative stake',
        { stake: 'NEGATIVE', doubleDown: false, sabotage: null },
        'INVALID_MESSAGE',
      ],
      [
        'a stake the ladder lacks',
        { stake: 'ALL_IN', doubleDown: false, sabotage: null },
        'STAKE_INVALID',
      ],
    ];
    for (const [label, payload, code] of hostile) {
      attacker.send('COMMIT_PREP', payload);
      expect((await attacker.nextOfType('ERROR')).payload.code, label).toBe(code);
    }
    expect(ledgerOf(party, attacker)).toMatchObject({
      tokens: 1,
      doubleDown: 2,
      lastSabotageRound: null,
    });
    expect(liveRoom(server, party.created.roomId).state.game!.round!.commitments).toEqual({});
    await closeParty(party);
  });

  it('spam gets one sabotage at most, whatever the attacker aims at', async () => {
    const party = await createParty(server, 4);
    await toRoundPrep(party, 2);
    const [attacker, ...others] = party.players as [TestClient, TestClient, TestClient, TestClient];
    for (const target of others) {
      attacker.send('COMMIT_PREP', {
        ...safe,
        sabotage: { targetId: target.playerId, effect: 'JAM' },
      });
    }
    const replies: ServerMessage[] = [];
    for (let i = 0; i < others.length; i++) {
      replies.push(
        await attacker.next((m) => m.type === 'ACK' || m.type === 'ERROR', 3_000, 'a reply'),
      );
    }
    expect(replies.filter((m) => m.type === 'ACK')).toHaveLength(1);
    expect(
      Object.values(liveRoom(server, party.created.roomId).state.game!.round!.commitments).filter(
        (c) => c.sabotage,
      ),
    ).toHaveLength(1);
    await closeParty(party);
  });

  it('cannot decide a stake after seeing the question', async () => {
    const party = await createParty(server, 3);
    await toRoundPrep(party, 0);
    const [late] = party.players as [TestClient, TestClient, TestClient];
    // Two others commit; the last holdout is the attacker, who waits for the options.
    party.players.slice(1).forEach((c) => c.send('COMMIT_PREP', { ...safe, sabotage: null }));
    const answering = await late.waitForPhase('ANSWERING', 15_000);
    expect(answering.payload.data.phase).toBe('ANSWERING');
    late.send('COMMIT_PREP', { stake: 'HIGH', doubleDown: true, sabotage: null });
    expect((await late.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');
    expect(ledgerOf(party, late).doubleDown).toBe(2);
    await closeParty(party);
  });

  it('50/50 after answering, or twice in one question, changes nothing', async () => {
    const party = await createParty(server, 2);
    await toRoundPrep(party, 0);
    party.players.forEach((c) => c.send('COMMIT_PREP', { ...safe, sabotage: null }));
    const [a, b] = party.players as [TestClient, TestClient];
    const entered = await a.waitForPhase('ANSWERING', 15_000);
    await b.waitForPhase('ANSWERING', 15_000);
    if (entered.payload.data.phase !== 'ANSWERING') throw new Error('unexpected phase');
    a.send('SUBMIT_ANSWER', {
      questionId: entered.payload.data.questionId,
      optionId: entered.payload.data.options[0]!.optionId,
    });
    await a.nextOfType('ANSWER_ACCEPTED');
    a.send('USE_FIFTY_FIFTY', {});
    expect((await a.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');
    b.send('USE_FIFTY_FIFTY', {});
    await b.nextOfType('ACK');
    b.send('USE_FIFTY_FIFTY', {});
    expect((await b.nextOfType('ERROR')).payload.code).toBe('POWER_UNAVAILABLE');
    expect(ledgerOf(party, a).fiftyFifty).toBe(1);
    expect(ledgerOf(party, b).fiftyFifty).toBe(0);
    await closeParty(party);
  });
});

describe("what an attacker can learn about other players' powers", () => {
  it('nothing: its own private view is the only one it ever receives', async () => {
    const party = await createParty(server, 3);
    await toRoundPrep(party, 2);
    const [attacker, victim, third] = party.players as [TestClient, TestClient, TestClient];
    victim.send('COMMIT_PREP', {
      stake: 'HIGH',
      doubleDown: true,
      sabotage: { targetId: third.playerId, effect: 'POINT_TAX' },
    });
    await victim.nextOfType('ACK');
    attacker.send('REQUEST_STATE', {});
    const snapshot = await attacker.nextOfType('ROOM_STATE');
    expect(snapshot.payload.room.you?.playerId).toBe(attacker.playerId);
    expect(snapshot.payload.room.you?.commitment).toBeNull();
    const everything = JSON.stringify(attacker.frames);
    expect(everything).not.toContain('POINT_TAX');
    expect(everything).not.toContain('"stake":"HIGH"');
    for (const message of attacker.messages) {
      if (message.type === 'PLAYER_STATE')
        expect(message.payload.you.playerId).toBe(attacker.playerId);
    }
    await closeParty(party);
  });
});
