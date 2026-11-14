import { call, player, type Player } from './payments';
import type { TestServer } from './server';

export const SENTINEL_ANSWER = 'zorba-the-sentinel-42';

/** The two personal-quiz modes are off by default (flags); tests that need them switch them on. */
export async function enablePersonalQuizzes(server: TestServer): Promise<void> {
  await server.db.db
    .updateTable('feature_flags')
    .set({ enabled: true })
    .where('key', 'in', ['mode.blind_quiz', 'mode.custom_quiz', 'mode.who_said_it'])
    .execute();
  server.built.flags.invalidate();
}

export interface ReadyQuiz {
  creator: Player;
  quizId: string;
  targetName: string;
  /** What the person answered, in prompt order (the correct options of the questions). */
  answers: string[];
}

/** A Blind Quiz about one person with three approved questions, built through the real HTTP API. */
export async function readyBlindQuiz(
  server: TestServer,
  options: { creator?: Player; targetName?: string; title?: string; sentinel?: string } = {},
): Promise<ReadyQuiz> {
  const creator = options.creator ?? (await player(server, 'WEB'));
  const targetName = options.targetName ?? 'Ece';
  const made = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
    token: creator.token,
    body: { kind: 'BLIND', title: options.title ?? 'Ece hakkında', language: 'tr' },
  });
  if (made.status !== 201) throw new Error(`quiz not created: ${made.status}`);
  const quizId = made.body.id;
  for (const catalogKey of ['dreamJob', 'dislikedFood', 'surprisingHobby'])
    await call(server, 'POST', `/v1/quizzes/${quizId}/prompts`, {
      token: creator.token,
      body: { catalogKey },
    });
  const target = await call<{ inviteUrl: string }>(
    server,
    'POST',
    `/v1/quizzes/${quizId}/targets`,
    { token: creator.token, body: { displayName: targetName } },
  );
  const invite = target.body.inviteUrl.split('/blind/respond/')[1]!;
  const view = await call<{ prompts: { promptId: string }[] }>(
    server,
    'GET',
    `/v1/blind/respond/${invite}`,
  );
  await call(server, 'POST', `/v1/blind/respond/${invite}/consent`, { body: {} });
  const answers = [options.sentinel ?? SENTINEL_ANSWER, 'Karnıyarık', 'Dokuma'];
  const decoys = [
    ['Pilot', 'Doktor', 'Aşçı'],
    ['Mantı', 'Lahmacun', 'Pilav'],
    ['Satranç', 'Resim', 'Yüzme'],
  ];
  for (const [i, prompt] of view.body.prompts.entries()) {
    const put = await call(
      server,
      'PUT',
      `/v1/blind/respond/${invite}/prompts/${prompt.promptId}`,
      {
        body: { answer: answers[i], decoys: decoys[i] },
      },
    );
    if (put.status !== 200) throw new Error(`answer refused: ${put.status}`);
    await call(server, 'POST', `/v1/blind/respond/${invite}/prompts/${prompt.promptId}/approval`, {
      body: { approved: true },
    });
  }
  return { creator, quizId, targetName, answers };
}

/** A Custom Quiz with `count` plain questions. */
export async function readyCustomQuiz(
  server: TestServer,
  count = 3,
  creator?: Player,
): Promise<{ creator: Player; quizId: string }> {
  const owner = creator ?? (await player(server, 'WEB'));
  const made = await call<{ id: string }>(server, 'POST', '/v1/quizzes', {
    token: owner.token,
    body: { kind: 'CUSTOM', title: 'Ofis quizi', language: 'tr' },
  });
  for (let i = 0; i < count; i += 1) {
    const added = await call(server, 'POST', `/v1/quizzes/${made.body.id}/questions`, {
      token: owner.token,
      body: {
        text: `Ofiste ${i + 1}. soru: hangisi doğru?`,
        options: ['Yanlış bir', 'Doğru olan', 'Yanlış iki'],
        correctIndex: 1,
      },
    });
    if (added.status !== 201) throw new Error(`question refused: ${added.status}`);
  }
  return { creator: owner, quizId: made.body.id };
}
