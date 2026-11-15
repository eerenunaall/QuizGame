import { randomUUID } from 'node:crypto';
import { generateRoomCode } from '@quizparty/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import { createRoom, resolveGameConfig, type PersistRecord } from '@quizparty/game-engine';
import { PgRoomStore } from '../../apps/realtime/src/rooms/store';
import { systemClock } from '../../apps/realtime/src/util/clock';
import { seedTestBank } from '../helpers/bank';

/**
 * What the game writes back to the bank (GDD §10, rubric §9): how often a question was used, how
 * many answered it, how many got it right, which option each player picked, who skipped. Persisting
 * a round twice (a replay after a crash, a retried write) must count it once.
 */
let t: TestDatabase;
let store: PgRoomStore;
const roomId = randomUUID();
const code = generateRoomCode();
const players = [randomUUID(), randomUUID(), randomUUID()] as const;

beforeAll(async () => {
  t = await createTestDatabase();
  await seedTestBank(t.db, 2);
  store = new PgRoomStore(t.db, 'test-instance', 10_000, systemClock);
  const state = createRoom({
    roomId,
    code,
    displaySessionId: randomUUID(),
    now: Date.now(),
    config: resolveGameConfig({}),
    tier: 'FULL',
    hostAccountId: null,
    contentLanguage: 'tr',
  });
  await store.createRoom({
    id: roomId,
    code,
    tier: 'FULL',
    language: 'tr',
    hostAccountId: null,
    state,
  });
});
afterAll(async () => {
  await t.drop();
});

async function setup() {
  const question = await t.db
    .selectFrom('questions')
    .select('id')
    .limit(1)
    .executeTakeFirstOrThrow();
  const options = await t.db
    .selectFrom('question_options')
    .select(['id', 'is_correct'])
    .where('question_id', '=', question.id)
    .orderBy('position')
    .execute();
  return {
    questionId: question.id,
    correct: options.find((o) => o.is_correct)!.id,
    wrong: options.filter((o) => !o.is_correct).map((o) => o.id),
  };
}

function round(gameId: string, questionId: string, correct: string, wrong: string): PersistRecord {
  const entry = (playerId: string, optionKey: string | null, isCorrect: boolean) => ({
    playerId,
    optionKey,
    correct: isCorrect,
    remainingMs: optionKey ? 4000 : 0,
    delta: isCorrect ? 100 : 0,
    totalAfter: isCorrect ? 100 : 0,
    components: [],
    stake: null,
    doubleDown: false,
    fiftyFifty: false,
  });
  return {
    type: 'ROUND_COMPLETED',
    gameId,
    roundIndex: 0,
    kind: 'STANDARD',
    questionId,
    answerMs: 10_000,
    correctOptionKey: correct,
    distribution: { [correct]: 1, [wrong]: 1 },
    players: [
      entry(players[0], correct, true),
      entry(players[1], wrong, false),
      entry(players[2], null, false),
    ],
    sabotages: [],
    configVersion: 1,
  };
}

const stats = async (questionId: string) => {
  const question = await t.db
    .selectFrom('questions')
    .select(['usage_count', 'answer_count', 'correct_answer_count', 'skip_count'])
    .where('id', '=', questionId)
    .executeTakeFirstOrThrow();
  const options = await t.db
    .selectFrom('question_options')
    .select(['id', 'pick_count'])
    .where('question_id', '=', questionId)
    .execute();
  return {
    usage: Number(question.usage_count),
    answers: Number(question.answer_count),
    correct: Number(question.correct_answer_count),
    skips: Number(question.skip_count),
    picks: Object.fromEntries(options.map((o) => [o.id, Number(o.pick_count)])),
  };
};

async function start(gameId: string) {
  await store.persistGameRecord(roomId, {
    type: 'GAME_STARTED',
    gameId,
    startedAt: Date.now(),
    totalRounds: 3,
    playerIds: [...players],
    configVersion: 1,
  });
}

describe('question statistics', () => {
  it('counts a finished round once: usage, answers, right answers, skips and the option each player picked', async () => {
    const { questionId, correct, wrong } = await setup();
    const gameId = randomUUID();
    await start(gameId);
    await store.persistGameRecord(roomId, round(gameId, questionId, correct, wrong[0]!));
    expect(await stats(questionId)).toMatchObject({
      usage: 1,
      answers: 2,
      correct: 1,
      skips: 1,
      picks: { [correct]: 1, [wrong[0]!]: 1, [wrong[1]!]: 0, [wrong[2]!]: 0 },
    });
  });

  it('does not count the same round again when it is persisted again (a replay after a crash)', async () => {
    const { questionId, correct, wrong } = await setup();
    const before = await stats(questionId);
    const gameId = randomUUID();
    await start(gameId);
    const record = round(gameId, questionId, correct, wrong[0]!);
    await store.persistGameRecord(roomId, record);
    const once = await stats(questionId);
    expect(once.usage).toBe(before.usage + 1);
    for (let replay = 0; replay < 3; replay++) await store.persistGameRecord(roomId, record);
    expect(await stats(questionId)).toEqual(once);
  });

  it('does count the question again in another game', async () => {
    const { questionId, correct, wrong } = await setup();
    const before = await stats(questionId);
    for (const gameId of [randomUUID(), randomUUID()]) {
      await start(gameId);
      await store.persistGameRecord(roomId, round(gameId, questionId, correct, wrong[1]!));
    }
    const after = await stats(questionId);
    expect(after.usage).toBe(before.usage + 2);
    expect(after.picks[wrong[1]!]).toBe(before.picks[wrong[1]!]! + 2);
  });

  it('ignores an option key that does not belong to the question', async () => {
    const { questionId, correct, wrong } = await setup();
    const before = await stats(questionId);
    const gameId = randomUUID();
    await start(gameId);
    await store.persistGameRecord(roomId, round(gameId, questionId, correct, randomUUID()));
    const after = await stats(questionId);
    expect(after.picks[correct]).toBe(before.picks[correct]! + 1);
    expect(after.picks[wrong[0]!]).toBe(before.picks[wrong[0]!]);
  });
});
