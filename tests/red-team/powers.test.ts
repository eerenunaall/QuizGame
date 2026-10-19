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
    riskPickMs: 5000,
    sabotagePickMs: 5000,
    riskPickDecisionMs: 5000,
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
const pass = { sabotage: null };

/** Plays up to RISK_PICK of round `index` (0-based); earlier rounds are fast-forwarded. */
async function toRoundPrep(party: Party, index: number): Promise<void> {
  const room = () => liveRoom(server, party.created.roomId);
  party.leader.send('SET_SETTINGS', { rounds: 6 });
  await party.leader.nextOfType('ACK');
  party.leader.send('START_GAME', {});
  for (let round = 0; ; round++) {
    await Promise.all(party.players.map((c) => c.waitForPhase('RISK_PICK', 10_000)));
    if (round === index) return;
    // Fast-forward: everyone commits SAFE (and passes on sabotage, which opens at round 3) and
    // answers at once, so each phase ends early.
    party.players.forEach((c) => c.send('COMMIT_RISK', safe));
    if (round >= 2) {
      await Promise.all(party.players.map((c) => c.waitForPhase('SABOTAGE_PICK', 10_000)));
      party.players.forEach((c) => c.send('COMMIT_SABOTAGE', pass));
    }
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

/** Plays up to SABOTAGE_PICK of round `index`: everybody locks SAFE in RISK_PICK first. */
async function toSabotagePick(party: Party, index: number): Promise<void> {
  await toRoundPrep(party, index);
  party.players.forEach((c) => c.send('COMMIT_RISK', safe));
  await Promise.all(party.players.map((c) => c.waitForPhase('SABOTAGE_PICK', 10_000)));
}

const ledgerOf = (party: Party, client: TestClient) =>
  liveRoom(server, party.created.roomId).state.game!.players[client.playerId!]!.powers;

describe('ATTACK 5 — replay a sabotage packet', () => {
  async function attacked() {
    const party = await createParty(server, 3);
    await toSabotagePick(party, 2);
    const [attacker, victim, bystander] = party.players as [TestClient, TestClient, TestClient];
    attacker.send('COMMIT_SABOTAGE', {
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
    expect(Object.values(round.sabotagePicks ?? {}).filter((c) => c.sabotage)).toHaveLength(1);
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
      liveRoom(server, party.created.roomId).state.game!.round!.sabotagePicks?.[
        bystander.playerId!
      ],
    ).toBeUndefined();
    expect(ledgerOf(party, bystander).tokens).toBe(1); // untouched
    expect(ledgerOf(party, attacker).tokens).toBe(0);
    await closeParty(party);
  });

  it('replayed in a later round it is just another sabotage: no token, no cooldown bypass', async () => {
    const { party, attacker, victim, bystander, frame } = await attacked();
    const captured = JSON.parse(frame) as Record<string, unknown>;
    // The others commit, round 3 (index 2) plays out, and round 4's preparation opens.
    victim.send('COMMIT_SABOTAGE', pass);
    bystander.send('COMMIT_SABOTAGE', pass);
    await Promise.all(party.players.map((c) => c.waitForPhase('RISK_PICK', 20_000)));
    const room = liveRoom(server, party.created.roomId);
    expect(room.state.game!.round!.index).toBe(3);
    attacker.sendRaw(JSON.stringify({ ...captured, sequence: ++attacker.sequence }));
    const reply = await attacker.next(
      (m) => m.type === 'ERROR' || m.type === 'ACK',
      3_000,
      'a reply',
    );
    expect(reply.type).toBe('ERROR');
    // Round 4 is in RISK_PICK: a sabotage is not legal there, token or not.
    if (reply.type === 'ERROR') expect(reply.payload.code).toBe('INVALID_STATE');
    expect(room.state.game!.round!.sabotagePicks?.[attacker.playerId!]).toBeUndefined();
    expect(ledgerOf(party, attacker)).toMatchObject({ tokens: 0, lastSabotageRound: 2 });
    await closeParty(party);
  });
});

describe('sabotage abuse', () => {
  it('refuses forged stakes and smuggled fields in RISK_PICK without spending anything', async () => {
    const party = await createParty(server, 3);
    await toRoundPrep(party, 2);
    const [attacker, victim] = party.players as [TestClient, TestClient, TestClient];
    const hostile: [string, unknown, string][] = [
      ['a smuggled shield override', { ...safe, shield: false }, 'INVALID_MESSAGE'],
      [
        'a sabotage smuggled into the stake intent',
        { ...safe, sabotage: { targetId: victim.playerId, effect: 'JAM' } },
        'INVALID_MESSAGE',
      ],
      ['a negative stake', { stake: 'NEGATIVE', doubleDown: false }, 'INVALID_MESSAGE'],
      ['a stake the ladder lacks', { stake: 'ALL_IN', doubleDown: false }, 'STAKE_INVALID'],
    ];
    for (const [label, payload, code] of hostile) {
      attacker.send('COMMIT_RISK', payload);
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

  it('cannot commit a sabotage in RISK_PICK, nor a stake in SABOTAGE_PICK', async () => {
    const party = await createParty(server, 3);
    await toRoundPrep(party, 2);
    const [attacker, victim] = party.players as [TestClient, TestClient, TestClient];
    attacker.send('COMMIT_SABOTAGE', {
      sabotage: { targetId: victim.playerId, effect: 'JAM' },
    });
    expect((await attacker.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');
    attacker.send('COMMIT_SABOTAGE', pass);
    expect((await attacker.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');
    expect(ledgerOf(party, attacker)).toMatchObject({ tokens: 1, lastSabotageRound: null });
    expect(liveRoom(server, party.created.roomId).state.game!.round!.sabotagePicks ?? {}).toEqual(
      {},
    );

    party.players.forEach((c) => c.send('COMMIT_RISK', safe));
    await Promise.all(party.players.map((c) => c.waitForPhase('SABOTAGE_PICK', 10_000)));
    attacker.send('COMMIT_RISK', { stake: 'HIGH', doubleDown: false });
    expect((await attacker.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');
    expect(
      liveRoom(server, party.created.roomId).state.game!.round!.commitments[attacker.playerId!],
    ).toMatchObject({ stake: 'SAFE' }); // the SAFE locked in RISK_PICK stands
    await closeParty(party);
  });

  it('refuses forged targets, forged effects and smuggled fields in SABOTAGE_PICK', async () => {
    const party = await createParty(server, 3);
    await toSabotagePick(party, 2);
    const [attacker, victim] = party.players as [TestClient, TestClient, TestClient];
    const hostile: [string, unknown, string][] = [
      ['yourself', { sabotage: { targetId: attacker.playerId, effect: 'JAM' } }, 'TARGET_INVALID'],
      ['a stranger', { sabotage: { targetId: 'nobody-here', effect: 'JAM' } }, 'TARGET_INVALID'],
      [
        'the TV',
        { sabotage: { targetId: party.created.display.sessionId, effect: 'JAM' } },
        'TARGET_INVALID',
      ],
      [
        'a lockout without a joker',
        { sabotage: { targetId: victim.playerId, effect: 'LOCKOUT' } },
        'POWER_UNAVAILABLE',
      ],
      [
        'the excluded NOISE effect',
        { sabotage: { targetId: victim.playerId, effect: 'NOISE' } },
        'INVALID_MESSAGE',
      ],
      [
        'a smuggled strength',
        { sabotage: { targetId: victim.playerId, effect: 'JAM', jamMs: 0 } },
        'INVALID_MESSAGE',
      ],
      [
        'a stake smuggled into the sabotage intent',
        { stake: 'HIGH', sabotage: null },
        'INVALID_MESSAGE',
      ],
    ];
    for (const [label, payload, code] of hostile) {
      attacker.send('COMMIT_SABOTAGE', payload);
      expect((await attacker.nextOfType('ERROR')).payload.code, label).toBe(code);
    }
    expect(ledgerOf(party, attacker)).toMatchObject({
      tokens: 1,
      doubleDown: 2,
      lastSabotageRound: null,
    });
    expect(liveRoom(server, party.created.roomId).state.game!.round!.sabotagePicks ?? {}).toEqual(
      {},
    );
    await closeParty(party);
  });

  it('spam gets one sabotage at most, whatever the attacker aims at', async () => {
    const party = await createParty(server, 4);
    await toSabotagePick(party, 2);
    const [attacker, ...others] = party.players as [TestClient, TestClient, TestClient, TestClient];
    for (const target of others) {
      attacker.send('COMMIT_SABOTAGE', {
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
      Object.values(
        liveRoom(server, party.created.roomId).state.game!.round!.sabotagePicks ?? {},
      ).filter((c) => c.sabotage),
    ).toHaveLength(1);
    await closeParty(party);
  });

  it('cannot decide a stake after seeing the question', async () => {
    const party = await createParty(server, 3);
    await toRoundPrep(party, 0);
    const [late] = party.players as [TestClient, TestClient, TestClient];
    // Two others commit; the last holdout is the attacker, who waits for the options.
    party.players.slice(1).forEach((c) => c.send('COMMIT_RISK', safe));
    const answering = await late.waitForPhase('ANSWERING', 15_000);
    expect(answering.payload.data.phase).toBe('ANSWERING');
    late.send('COMMIT_RISK', { stake: 'HIGH', doubleDown: true });
    expect((await late.nextOfType('ERROR')).payload.code).toBe('INVALID_STATE');
    expect(ledgerOf(party, late).doubleDown).toBe(2);
    await closeParty(party);
  });

  it('50/50 after answering, or twice in one question, changes nothing', async () => {
    const party = await createParty(server, 2);
    await toRoundPrep(party, 0);
    party.players.forEach((c) => c.send('COMMIT_RISK', safe));
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
    victim.send('COMMIT_RISK', { stake: 'RISK', doubleDown: true });
    await victim.nextOfType('ACK');
    attacker.send('COMMIT_RISK', safe);
    third.send('COMMIT_RISK', safe);
    await Promise.all(party.players.map((c) => c.waitForPhase('SABOTAGE_PICK', 10_000)));
    victim.send('COMMIT_SABOTAGE', {
      sabotage: { targetId: third.playerId, effect: 'POINT_TAX' },
    });
    await victim.nextOfType('ACK');
    attacker.send('REQUEST_STATE', {});
    const snapshot = await attacker.nextOfType('ROOM_STATE');
    expect(snapshot.payload.room.you?.playerId).toBe(attacker.playerId);
    expect(snapshot.payload.room.you?.commitment).toMatchObject({ stake: 'SAFE', sabotage: null });
    // `offered` is the sabotage menu (config, ADR-0023), the same for everybody: not anybody's pick.
    const everything = JSON.stringify(
      attacker.frames.map((frame) => JSON.parse(frame) as unknown),
      (key, entry: unknown) => (key === 'offered' ? undefined : entry),
    );
    expect(everything).not.toContain('POINT_TAX');
    expect(everything).not.toContain('"stake":"HIGH"');
    for (const message of attacker.messages) {
      if (message.type === 'PLAYER_STATE')
        expect(message.payload.you.playerId).toBe(attacker.playerId);
    }
    await closeParty(party);
  });

  it('the TV and the other phones see only how many locked in during SABOTAGE_PICK (ATTACK 27)', async () => {
    const party = await createParty(server, 4);
    await toSabotagePick(party, 2);
    const [attacker, victim, ...rest] = party.players as [
      TestClient,
      TestClient,
      TestClient,
      TestClient,
    ];
    const watchers = [party.display, victim, ...rest];
    const before = new Map(watchers.map((c) => [c, c.messages.length]));
    attacker.send('COMMIT_SABOTAGE', {
      sabotage: { targetId: victim.playerId, effect: 'SHUFFLE' },
    });
    await attacker.nextOfType('ACK');
    // Everyone online is told a count moved; nobody is told who, whom or what.
    for (const client of watchers) {
      const progress = await client.next(
        (m) => m.type === 'PREP_PROGRESS' && m.payload.committedCount === 1,
        3_000,
        'PREP_PROGRESS',
      );
      expect(progress.type === 'PREP_PROGRESS' && progress.payload).toEqual({
        committedCount: 1,
        eligibleCount: 4,
      });
    }
    for (const client of watchers) {
      const frames = JSON.stringify(client.frames.slice(before.get(client)));
      expect(frames, 'a tick must not name the attacker').not.toContain(attacker.playerId!);
      expect(frames).not.toContain('SHUFFLE');
      expect(frames).not.toContain('"sabotage"');
    }
    // The room view the TV would load now says the same: a bare count.
    party.display.send('REQUEST_STATE', {});
    const view = await party.display.nextOfType('ROOM_STATE');
    expect(view.payload.room.phaseData).toMatchObject({
      phase: 'SABOTAGE_PICK',
      committedCount: 1,
      eligibleCount: 4,
    });
    expect(JSON.stringify(view.payload.room.phaseData)).not.toContain(attacker.playerId!);
    await closeParty(party);
  });
});
