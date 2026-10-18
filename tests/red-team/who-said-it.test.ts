import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@quizparty/protocol';
import type { TestClient } from '../helpers/client';
import { liveRoom } from '../helpers/oracle';
import { closeParty, createParty, type Party } from '../helpers/party';
import { enablePersonalQuizzes } from '../helpers/quizzes';
import { startServer, type TestServer } from '../helpers/server';

/**
 * ATTACK 26 — Who Said It (GDD §7.9, ADR-0015): read someone's statement before its question is on
 * screen, work out an author from anything a client receives, or answer for yourself.
 * The words are the question; the author is the answer. Neither may reach a client early.
 */
let server: TestServer;
let strict: TestServer;
beforeAll(async () => {
  server = await startServer({ env: { DEFAULT_ROOM_TIER: 'FULL' } });
  strict = await startServer({ env: { DEFAULT_ROOM_TIER: 'FULL', RATE_LIMIT_SCALE: '1' } });
  await enablePersonalQuizzes(server);
  await enablePersonalQuizzes(strict);
});
afterAll(async () => {
  await Promise.all([server.dispose(), strict.dispose()]);
});

const SENTINEL = `attack26-${Date.now()}`;
const WORDS = [`${SENTINEL} kedi`, `${SENTINEL} pizza`, `${SENTINEL} ağlamam`];

async function lobby(target: TestServer, count = 3): Promise<Party> {
  const party = await createParty(target, count);
  const room = liveRoom(target, party.created.roomId);
  expect(await room.setContent('WHO_SAID_IT', null, null, null)).toEqual({ ok: true });
  return party;
}
async function submit(client: TestClient, text: string): Promise<ServerMessage> {
  const id = client.send('SUBMIT_STATEMENT', { text });
  return client.next(
    (m) => (m.type === 'ACK' || m.type === 'ERROR') && m.payload.messageId === id,
    5_000,
    'statement reply',
  );
}
const textOf = (message: ServerMessage): string | null => {
  const payload = message.payload as {
    data?: { text?: string };
    room?: { phaseData?: { text?: string } };
  };
  return payload.data?.text ?? payload.room?.phaseData?.text ?? null;
};

/** Every frame that contains a word must be the one that puts that word on screen as the question (or the owner's own lobby copy). */
function earlyReads(client: TestClient, own: string | null): string[] {
  const shown = new Set<string>();
  const leaks: string[] = [];
  client.messages.forEach((message, index) => {
    const text = textOf(message);
    if (text) shown.add(text);
    const frame = client.frames[index]!;
    for (const word of WORDS) {
      if (word === own || shown.has(word) || !frame.includes(word)) continue;
      leaks.push(`#${index} ${message.type}`);
    }
  });
  return leaks;
}

describe('ATTACK 26 — Who Said It', () => {
  it('shows no statement to anyone before its question is on screen, and never says who wrote it', async () => {
    const party = await lobby(server);
    for (const [i, client] of party.players.entries())
      expect((await submit(client, WORDS[i]!)).type).toBe('ACK');
    // a latecomer who reconnects mid-lobby and asks for state sees counts only
    const spy = party.players[2]!;
    spy.send('REQUEST_STATE', {});
    await spy.nextOfType('ROOM_STATE');

    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    const authors = new Map(WORDS.map((w, i) => [w, party.players[i]!]));
    for (let round = 0; round < 3; round += 1) {
      const entered = await party.players[0]!.waitForPhase('ANSWERING', 15_000);
      const data = entered.payload.data;
      if (data.phase !== 'ANSWERING') throw new Error('not answering');
      const author = authors.get(data.text)!;
      for (const client of party.players)
        if (client !== author)
          client.send('SUBMIT_ANSWER', {
            questionId: data.questionId,
            optionId: data.options[0]!.optionId,
          });
      await party.players[0]!.waitForPhase('SCORE_UPDATE', 15_000);
    }
    await party.players[0]!.waitForPhase('RESULTS', 15_000);

    expect(earlyReads(party.display, null)).toEqual([]);
    party.players.forEach((client, i) => {
      expect(earlyReads(client, WORDS[i]!)).toEqual([]);
    });
    // the checker is not vacuous: the TV did get every statement, at the question
    for (const word of WORDS) expect(party.display.frames.some((f) => f.includes(word))).toBe(true);
    // nothing a client got names an author
    for (const client of [party.display, ...party.players])
      for (const message of client.messages)
        expect(JSON.stringify(message.payload)).not.toMatch(
          /authorPlayerId|"authorId"|"statements"/u,
        );
    for (const message of party.display.messages)
      expect(JSON.stringify(message.payload)).not.toContain('authorOfRound":true');
    await closeParty(party);
  });

  it('refuses an author who answers, stakes or 50/50s on their own statement, and counts nothing for them', async () => {
    const party = await lobby(server);
    for (const [i, client] of party.players.entries()) await submit(client, WORDS[i]!);
    const room = liveRoom(server, party.created.roomId);
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');

    await Promise.all(party.players.map((c) => c.waitForPhase('QUESTION_PREP', 10_000)));
    const deckQuestion = room.state.game!.deck.questions[room.state.game!.round!.questionId]!;
    const author = party.players.find((c) => c.playerId === deckQuestion.authorPlayerId)!;
    const guessers = party.players.filter((c) => c !== author);

    const stake = author.send('COMMIT_PREP', { stake: 'SAFE', doubleDown: true, sabotage: null });
    expect(
      (await author.next((m) => m.type === 'ERROR' && m.payload.messageId === stake)).payload,
    ).toMatchObject({ code: 'ANSWER_NOT_ALLOWED' });
    expect(room.state.game!.players[author.playerId!]!.powers.doubleDown).toBe(2); // nothing spent

    const entered = await author.waitForPhase('ANSWERING', 10_000);
    const data = entered.payload.data;
    if (data.phase !== 'ANSWERING') throw new Error('not answering');
    const truth = deckQuestion.options.find((o) => o.correct)!.key;
    const rightOption = room.state.game!.round!.question!.options.find((o) => o.key === truth)!;
    for (const optionId of [rightOption.optionId, data.options[0]!.optionId, 'AAAAAAAAAAAA']) {
      const id = author.send('SUBMIT_ANSWER', { questionId: data.questionId, optionId });
      const rejected = await author.next(
        (m) => m.type === 'ANSWER_REJECTED' && m.payload.messageId === id,
      );
      expect(rejected.type === 'ANSWER_REJECTED' && rejected.payload.code).toBe(
        'ANSWER_NOT_ALLOWED',
      );
    }
    const joker = author.send('USE_FIFTY_FIFTY', {});
    expect(
      (await author.next((m) => m.type === 'ERROR' && m.payload.messageId === joker)).payload,
    ).toMatchObject({ code: 'POWER_UNAVAILABLE' });
    expect(room.state.game!.round!.answers[author.playerId!]).toBeUndefined();

    // the guessers answer wrongly on purpose: the author's score and streak do not move either way
    for (const client of guessers)
      client.send('SUBMIT_ANSWER', {
        questionId: data.questionId,
        optionId: data.options.find((o) => o.playerId === client.playerId)!.optionId,
      });
    await author.waitForPhase('SCORE_UPDATE', 10_000);
    const mine = room.state.game!.players[author.playerId!]!;
    expect(mine.score).toBe(0);
    expect(mine.streak).toBe(0);
    expect(room.state.game!.round!.outcome!.players[author.playerId!]).toBeUndefined();
    await closeParty(party);
  });

  it('only takes statements from players, in the lobby, as moderated text', async () => {
    const party = await lobby(server);
    const [a, b] = party.players as [TestClient, TestClient];
    // the TV and a hostile payload shape
    party.display.send('SUBMIT_STATEMENT', { text: 'tv' });
    expect((await party.display.nextOfType('ERROR')).payload.code).toBe('FORBIDDEN');
    const smuggled = a.send('SUBMIT_STATEMENT', { text: 'merhaba', authorPlayerId: b.playerId });
    expect(
      (await a.next((m) => m.type === 'ERROR' && m.payload.messageId === smuggled)).payload,
    ).toMatchObject({ code: 'INVALID_MESSAGE' });
    // links, swearing, bidi tricks, oversize, empty: refused, never echoed or stored
    for (const [text, reason] of [
      ['https://evil.example/x', 'LINK'],
      ['amk', 'PROFANITY'],
      ['abc\u202edef', 'FORBIDDEN_CHARACTER'],
      ['x'.repeat(141), 'TOO_LONG'],
      ['   ', 'EMPTY'],
    ] as const) {
      expect(await submit(a, text)).toMatchObject({
        type: 'ERROR',
        payload: { code: 'TEXT_REJECTED', params: { reason } },
      });
    }
    expect(Object.keys(liveRoom(server, party.created.roomId).state.statements)).toEqual([]);
    // one per player: a second send replaces the first
    await submit(a, 'birinci');
    await submit(a, 'ikinci');
    expect(Object.values(liveRoom(server, party.created.roomId).state.statements)).toEqual([
      'ikinci',
    ]);
    // once the game runs, the words can no longer be changed
    await submit(b, 'öteki');
    party.leader.send('START_GAME', {});
    await party.leader.nextOfType('ACK');
    await a.waitForPhase('ROUND_INTRO', 10_000);
    expect(await submit(a, 'çok geç')).toMatchObject({
      type: 'ERROR',
      payload: { code: 'INVALID_STATE' },
    });
    expect(Object.values(liveRoom(server, party.created.roomId).state.statements).sort()).toEqual([
      'ikinci',
      'öteki',
    ]);
    await closeParty(party);
  });

  it('is not available in a classic room and is rate limited per phone', async () => {
    const classic = await createParty(strict, 2);
    expect(await submit(classic.players[0]!, 'klasik odada')).toMatchObject({
      type: 'ERROR',
      payload: { code: 'INVALID_STATE' },
    });
    await closeParty(classic);

    const party = await lobby(strict, 2);
    const replies: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const reply = await submit(party.players[0]!, `söz ${i}`);
      replies.push(reply.type === 'ERROR' ? reply.payload.code : 'ACK');
    }
    expect(replies.filter((code) => code === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(5);
    expect(Object.values(liveRoom(strict, party.created.roomId).state.statements)).toHaveLength(1);
    await closeParty(party);
  });
});
