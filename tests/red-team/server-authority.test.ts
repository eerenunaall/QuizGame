import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@quizparty/protocol';
import { PROTOCOL_VERSION } from '@quizparty/protocol';
import type { TestClient } from '../helpers/client';
import { correctOptionId, liveRoom, wrongOptionId } from '../helpers/oracle';
import { closeParty, createParty, type Party } from '../helpers/party';
import { waitForSecurityEvent } from '../helpers/security';
import { FAST_GAME_CONFIG, startServer, type TestServer } from '../helpers/server';

/**
 * Attacker's view of the rules that make cheating pointless: the server owns time, scores,
 * turns and authority (GDD §19–§20, brief §26 ATTACK 1–6). Each test plays the attacker, then
 * proves the defender's state did not move.
 */

const WIDE_ANSWER_WINDOW = {
  ...FAST_GAME_CONFIG,
  timings: {
    ...FAST_GAME_CONFIG.timings,
    answerMs: { STANDARD: 5000, SPEED: 5000, RISK: 5000, CROWD: 5000, FINAL: 5000 },
  },
};

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ gameConfig: WIDE_ANSWER_WINDOW });
});
afterAll(async () => {
  await server.dispose();
});

type Entered = Extract<ServerMessage, { type: 'PHASE_ENTERED' }>;
type AnsweringData = Extract<Entered['payload']['data'], { phase: 'ANSWERING' }>;

async function startAndAwaitQuestion(party: Party): Promise<AnsweringData> {
  party.leader.send('START_GAME', {});
  const entered = await party.leader.waitForPhase('ANSWERING', 10_000);
  return entered.payload.data as AnsweringData;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function scoreOf(party: Party): Map<string, number> {
  const room = liveRoom(server, party.created.roomId);
  return new Map(
    Object.entries(room.state.game?.players ?? {}).map(([id, player]) => [id, player.score]),
  );
}

describe('ATTACK 1 — modify client score', () => {
  it('refuses every attempt to smuggle a score, rank or delta into a message', async () => {
    const party = await createParty(server, 2);
    const question = await startAndAwaitQuestion(party);
    const [cheater, honest] = party.players as [TestClient, TestClient];
    const option = question.options[0]!.optionId;

    const attempts: Record<string, unknown>[] = [
      { questionId: question.questionId, optionId: option, score: 99_999 },
      { questionId: question.questionId, optionId: option, points: 1_000_000, delta: 1_000_000 },
      { questionId: question.questionId, optionId: option, rank: 1, streak: 50 },
      { questionId: question.questionId, optionId: option, correct: true },
      JSON.parse(
        `{"questionId":"${question.questionId}","optionId":"${option}","__proto__":{"score":99999}}`,
      ) as Record<string, unknown>,
      {
        questionId: question.questionId,
        optionId: option,
        constructor: { prototype: { score: 1 } },
      },
    ];
    for (const payload of attempts) {
      cheater.send('SUBMIT_ANSWER', payload);
      const reply = await cheater.next(
        (m) => m.type === 'ERROR' || m.type === 'ANSWER_REJECTED' || m.type === 'ANSWER_ACCEPTED',
        3_000,
        'a refusal',
      );
      expect(reply.type, JSON.stringify(payload)).toBe('ERROR');
      if (reply.type === 'ERROR') expect(reply.payload.code).toBe('INVALID_MESSAGE');
    }
    // nothing was recorded for the cheater and nobody's score moved
    const room = liveRoom(server, party.created.roomId);
    expect(room.state.game?.round?.answers[cheater.playerId!]).toBeUndefined();
    expect([...scoreOf(party).values()]).toEqual([0, 0]);
    expect(honest.playerId).not.toBe(cheater.playerId);
    await closeParty(party);
  });

  it('refuses server-only message types and host fields sent by a client', async () => {
    const party = await createParty(server, 2);
    const cheater = party.players[1]!; // not the leader
    const tierBefore = liveRoom(server, party.created.roomId).state.tier;
    const forge = (extra: Record<string, unknown>) =>
      cheater.sendRaw(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          messageId: crypto.randomUUID(),
          roomId: party.created.roomId,
          sessionId: cheater.sessionId,
          sequence: ++cheater.sequence,
          timestamp: Date.now(),
          ...extra,
        }),
      );
    for (const forged of [
      { type: 'PHASE_ENTERED', payload: { data: { phase: 'RESULTS', ranking: [], awards: [] } } },
      { type: 'SCORE_UPDATE', payload: { deltas: [{ playerId: cheater.playerId, delta: 9999 }] } },
      { type: 'ANSWER_ACCEPTED', payload: {} },
      { type: 'LEADER_CHANGED', payload: { playerId: cheater.playerId } },
      { type: 'READY', payload: { ready: true, isLeader: true, canHost: true } },
      { type: 'SET_SETTINGS', payload: { rounds: 3, tier: 'FULL', maxPlayers: 99 } },
    ]) {
      forge(forged);
      const reply = await cheater.nextOfType('ERROR', 3_000);
      expect(reply.payload.code, forged.type).toBe('INVALID_MESSAGE');
    }
    const room = liveRoom(server, party.created.roomId);
    expect(room.state.phase).toBe('LOBBY');
    expect(room.state.tier).toBe(tierBefore); // no way to self-upgrade
    expect(room.state.leaderPlayerId).not.toBe(cheater.playerId);
    await closeParty(party);
  });
});

describe('ATTACK 2 — change client timer', () => {
  it('scores speed from the server clock, whatever clientSentAt claims', async () => {
    const party = await createParty(server, 2);
    const question = await startAndAwaitQuestion(party);
    const [honest, liar] = party.players as [TestClient, TestClient];
    const right = correctOptionId(server, party.created.roomId);
    await sleep(1_200); // well into the window: an honest speed bonus is clearly below the maximum

    honest.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: right,
      clientSentAt: Date.now(),
    });
    liar.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: right,
      clientSentAt: question.answerOpensAt, // "I answered the very instant the options appeared"
    });
    await honest.nextOfType('ANSWER_ACCEPTED');
    await liar.nextOfType('ANSWER_ACCEPTED');

    const update = await party.display.next(
      (m) => m.type === 'PHASE_ENTERED' && m.payload.data.phase === 'SCORE_UPDATE',
      10_000,
      'SCORE_UPDATE',
    );
    const data = (update as Entered).payload.data;
    if (data.phase !== 'SCORE_UPDATE') throw new Error('unexpected phase');
    const speed = (playerId: string) =>
      data.deltas
        .find((delta) => delta.playerId === playerId)
        ?.components.find((component) => component.kind === 'SPEED')?.points ?? 0;
    const round = liveRoom(server, party.created.roomId).state.game!.round!;
    const honestSpeed = speed(honest.playerId!);
    const liarSpeed = speed(liar.playerId!);
    expect(honestSpeed).toBeGreaterThan(0);
    expect(liarSpeed).toBeLessThan(round.speedMax * 0.9); // the claimed instant answer earned nothing extra
    expect(Math.abs(liarSpeed - honestSpeed)).toBeLessThanOrEqual(round.speedMax * 0.06);
    await closeParty(party);
  });

  it('ignores a forged envelope timestamp and a clientSentAt from the future', async () => {
    const party = await createParty(server, 2);
    const question = await startAndAwaitQuestion(party);
    const [a] = party.players as [TestClient, TestClient];
    a.sendRaw(
      JSON.stringify({
        type: 'SUBMIT_ANSWER',
        protocolVersion: PROTOCOL_VERSION,
        messageId: crypto.randomUUID(),
        roomId: party.created.roomId,
        sessionId: a.sessionId,
        sequence: ++a.sequence,
        timestamp: Date.now() + 3_600_000,
        payload: {
          questionId: question.questionId,
          optionId: question.options[0]!.optionId,
          clientSentAt: Date.now() + 3_600_000,
        },
      }),
    );
    const accepted = await a.nextOfType('ANSWER_ACCEPTED');
    // the lock time is the server's receive time, not the forged one
    expect(Math.abs(accepted.payload.lockedAt - Date.now())).toBeLessThan(5_000);
    await closeParty(party);
  });
});

describe('ATTACK 3 — answer after the deadline', () => {
  it('rejects a late answer with ANSWER_LATE and records nothing', async () => {
    const party = await createParty(server, 2);
    const question = await startAndAwaitQuestion(party);
    const [a] = party.players as [TestClient, TestClient];
    await a.waitForPhase('LOCKED', 10_000); // nobody answered: the window expired
    a.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: correctOptionId(server, party.created.roomId),
      clientSentAt: question.answerOpensAt + 100, // claims it was on time
    });
    expect((await a.nextOfType('ANSWER_REJECTED')).payload.code).toBe('ANSWER_LATE');
    expect(liveRoom(server, party.created.roomId).state.game?.round?.answers).toEqual({});
    await closeParty(party);
  });
});

describe('ATTACK 4 — replay an answer packet', () => {
  it('rejects the verbatim replay, and a re-sequenced replay is a duplicate, not a second answer', async () => {
    const party = await createParty(server, 3);
    const question = await startAndAwaitQuestion(party);
    const [a, b] = party.players as [TestClient, TestClient, TestClient];
    a.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: wrongOptionId(server, party.created.roomId),
    });
    await a.nextOfType('ANSWER_ACCEPTED');
    const captured = JSON.parse(a.lastSentFrame!) as Record<string, unknown>;
    await b.nextOfType('ANSWER_LOCKED');

    // 1. byte-for-byte replay
    a.sendRaw(a.lastSentFrame!);
    expect((await a.nextOfType('ERROR')).payload.code).toBe('STALE_SEQUENCE');
    // 2. same message id, newer sequence (the attacker "fixes" the replay protection)
    a.sendRaw(JSON.stringify({ ...captured, sequence: ++a.sequence }));
    const second = await a.next(
      (m) => m.type === 'ANSWER_REJECTED' || m.type === 'ANSWER_ACCEPTED',
      3_000,
      'a reply to the re-sequenced replay',
    );
    expect(['ANSWER_REJECTED', 'ANSWER_ACCEPTED']).toContain(second.type);
    if (second.type === 'ANSWER_REJECTED') expect(second.payload.code).toBe('ANSWER_DUPLICATE');
    // still exactly one answer on record, and only one lock announcement went out
    const room = liveRoom(server, party.created.roomId);
    expect(Object.keys(room.state.game!.round!.answers)).toEqual([a.playerId]);
    expect(b.messages.filter((m) => m.type === 'ANSWER_LOCKED')).toHaveLength(1);
    await closeParty(party);
  });

  it("cannot replay another player's captured packet from a different socket", async () => {
    const party = await createParty(server, 3);
    const question = await startAndAwaitQuestion(party);
    const [victim, attacker] = party.players as [TestClient, TestClient, TestClient];
    victim.send('SUBMIT_ANSWER', {
      questionId: question.questionId,
      optionId: question.options[0]!.optionId,
    });
    await victim.nextOfType('ANSWER_ACCEPTED');
    attacker.sendRaw(victim.lastSentFrame!); // victim's session id inside the attacker's socket
    const reply = await attacker.nextOfType('ERROR');
    expect(['FORBIDDEN', 'UNAUTHORIZED', 'STALE_SEQUENCE', 'INVALID_STATE']).toContain(
      reply.payload.code,
    );
    expect(
      liveRoom(server, party.created.roomId).state.game!.round!.answers[attacker.playerId!],
    ).toBeUndefined();
    await closeParty(party);
  });
});

describe('ATTACK 6 — forge a host command from a player session', () => {
  const HOST_ONLY = [
    ['START_GAME', {}],
    ['SET_SETTINGS', { rounds: 3 }],
    ['END_ROOM', {}],
    ['REMATCH', {}],
    ['BACK_TO_LOBBY', {}],
  ] as const;

  it('refuses every host command from a plain player and logs it', async () => {
    const party = await createParty(server, 3);
    const guest = party.players[2]!;
    for (const [type, payload] of HOST_ONLY) {
      guest.send(type, payload);
      const reply = await guest.nextOfType('ERROR');
      expect(['NOT_HOST', 'INVALID_STATE'], type).toContain(reply.payload.code);
    }
    guest.send('KICK_PLAYER', { playerId: party.leader.playerId });
    expect((await guest.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    guest.send('TRANSFER_LEADER', { playerId: guest.playerId });
    expect((await guest.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    await waitForSecurityEvent(server, { roomId: party.created.roomId }, 'HOST_COMMAND_FORBIDDEN');
    const room = liveRoom(server, party.created.roomId);
    expect(room.state.phase).toBe('LOBBY');
    expect(room.state.leaderPlayerId).toBe(party.leader.playerId);
    await closeParty(party);
  });

  it("cannot borrow the TV's identity: a frame claiming the display session is refused", async () => {
    const party = await createParty(server, 2);
    const guest = party.players[1]!;
    guest.send('START_GAME', {}, { sessionId: party.created.display.sessionId });
    const reply = await guest.next(
      (m) => m.type === 'ERROR',
      3_000,
      'a refusal of the forged session id',
    );
    expect(reply.type).toBe('ERROR');
    expect(liveRoom(server, party.created.roomId).state.phase).toBe('LOBBY');
    await closeParty(party);
  });

  it('a deposed leader loses host powers once leadership migrates', async () => {
    const party = await createParty(server, 3);
    const [oldLeader, next] = party.players as [TestClient, TestClient, TestClient];
    party.leader.send('TRANSFER_LEADER', { playerId: next.playerId });
    await oldLeader.nextOfType('ACK');
    oldLeader.send('START_GAME', {});
    expect((await oldLeader.nextOfType('ERROR')).payload.code).toBe('NOT_HOST');
    next.send('SET_SETTINGS', { rounds: 4 });
    await next.nextOfType('ACK');
    await closeParty(party);
  });
});
