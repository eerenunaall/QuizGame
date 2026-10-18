import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, player } from '../helpers/payments';
import { startModelServer, type ModelRequest, type ModelServer } from '../helpers/model-server';
import { startServer, type TestServer } from '../helpers/server';

/**
 * AI decoy suggestions (ADR-0015 "Bounded AI", acceptance AB). The remote model is a local server that
 * speaks the provider's real wire format; the app's real client, breaker, validation and routes run
 * unchanged. Off (flag) and failing both mean "no suggestions: the target writes their own".
 */
const KEY = 'sk-decoy-test-key-0123456789';
const ANSWER = 'ai-decoy-sentinel-7';
const NAME = 'Ecem';
const TITLE = 'Ecem hakkinda ozel baslik';

let modelReply: (request: ModelRequest) => { text: string; delayMs?: number } | { status: number };
let model: ModelServer;
let server: TestServer;
const servers: TestServer[] = [];

beforeAll(async () => {
  model = await startModelServer((request) => modelReply(request));
  server = await boot();
});
afterAll(async () => {
  await Promise.all(servers.map((s) => s.dispose()));
  await model.close();
});

async function boot(env: Record<string, string> = {}): Promise<TestServer> {
  const s = await startServer({
    env: {
      AI_DECOYS_API_KEY: KEY,
      AI_DECOYS_MODEL: 'decoy-test-model',
      AI_DECOYS_API_BASE: model.url,
      ...env,
    },
  });
  servers.push(s);
  await s.db.db
    .updateTable('feature_flags')
    .set({ enabled: true })
    .where('key', 'in', ['mode.blind_quiz', 'mode.custom_quiz'])
    .execute();
  s.built.flags.invalidate();
  return s;
}
async function setAi(s: TestServer, enabled: boolean): Promise<void> {
  await s.db.db
    .updateTable('feature_flags')
    .set({ enabled })
    .where('key', '=', 'ai.decoys')
    .execute();
  s.built.flags.invalidate();
}

interface Ready {
  token: string;
  dreamId: string;
  customId: string;
}
/** One target, a catalogue prompt and a custom prompt naming them, both answered. */
async function quiz(
  s: TestServer,
  options: { consent?: boolean; answer?: boolean } = {},
): Promise<Ready> {
  const creator = await player(s, 'WEB');
  const made = await call<{ id: string }>(s, 'POST', '/v1/quizzes', {
    token: creator.token,
    body: { kind: 'BLIND', title: TITLE, language: 'en' },
  });
  const id = made.body.id;
  await call(s, 'POST', `/v1/quizzes/${id}/prompts`, {
    token: creator.token,
    body: { catalogKey: 'dreamJob' },
  });
  await call(s, 'POST', `/v1/quizzes/${id}/prompts`, {
    token: creator.token,
    body: { text: `What would ${NAME.toLowerCase()} never eat?` },
  });
  const target = await call<{ inviteUrl: string }>(s, 'POST', `/v1/quizzes/${id}/targets`, {
    token: creator.token,
    body: { displayName: NAME },
  });
  const token = target.body.inviteUrl.split('/blind/respond/')[1]!;
  const view = await call<{ prompts: { promptId: string }[] }>(
    s,
    'GET',
    `/v1/blind/respond/${token}`,
  );
  if (options.consent !== false)
    await call(s, 'POST', `/v1/blind/respond/${token}/consent`, { body: {} });
  const [dream, custom] = view.body.prompts as [{ promptId: string }, { promptId: string }];
  if (options.answer !== false)
    for (const prompt of [dream, custom])
      await call(s, 'PUT', `/v1/blind/respond/${token}/prompts/${prompt.promptId}`, {
        body: { answer: ANSWER, decoys: [] },
      });
  return { token, dreamId: dream.promptId, customId: custom.promptId };
}
const suggest = (s: TestServer, q: Ready, promptId: string) =>
  call<{ decoys: string[]; source: string; error?: { code: string } }>(
    s,
    'POST',
    `/v1/blind/respond/${q.token}/prompts/${promptId}/suggest-decoys`,
    { body: {} },
  );
const good = (decoys: string[]) => ({ text: JSON.stringify({ decoys }) });

describe('with the flag off (the default)', () => {
  it('never calls the remote model and answers with no suggestions', async () => {
    model.requests.length = 0;
    modelReply = () => good(['Pilot', 'Doktor', 'Aşçı']);
    const q = await quiz(server);
    const result = await suggest(server, q, q.dreamId);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ decoys: [], source: 'NONE' });
    expect(model.requests).toHaveLength(0);
  });
});

describe('with the flag on', () => {
  it('sends only the wording and the answer, and returns sanitised suggestions without storing them', async () => {
    await setAi(server, true);
    model.requests.length = 0;
    modelReply = () => good(['Pilot', 'Doctor ', 'Chef']);
    const q = await quiz(server);
    const result = await suggest(server, q, q.dreamId);
    expect(result.body).toEqual({ decoys: ['Pilot', 'Doctor', 'Chef'], source: 'AI' });

    expect(model.requests).toHaveLength(1);
    const sent = model.requests[0]!;
    expect(sent.path).toBe('/v1/messages');
    expect(sent.headers['x-api-key']).toBe(KEY);
    expect(sent.body.model).toBe('decoy-test-model');
    expect(sent.body.messages).toHaveLength(1);
    // exactly three fields: nothing about the person, the quiz or the account
    expect(JSON.parse(sent.body.messages[0]!.content)).toEqual({
      language: 'en',
      question: 'What did you want to be when you grew up?',
      answer: ANSWER,
    });
    const wire = JSON.stringify(sent.body);
    for (const secret of [NAME, TITLE, q.token, q.dreamId, KEY])
      expect(wire.toLowerCase()).not.toContain(secret.toLowerCase());

    // the suggestion is not stored: the target's own record is unchanged until they PUT
    const view = await call<{ prompts: { response: { decoys: string[] } | null }[] }>(
      server,
      'GET',
      `/v1/blind/respond/${q.token}`,
    );
    expect(view.body.prompts[0]!.response!.decoys).toEqual([]);
  });

  it('removes the target’s name from a custom prompt before it leaves', async () => {
    model.requests.length = 0;
    modelReply = () => good(['Okra', 'Liver', 'Kale']);
    const q = await quiz(server);
    expect((await suggest(server, q, q.customId)).body.source).toBe('AI');
    const content = JSON.parse(model.requests[0]!.body.messages[0]!.content) as {
      question: string;
    };
    expect(content.question).toBe('What would someone never eat?');
  });

  it('drops unusable output and falls back when nothing usable is left', async () => {
    const q = await quiz(server);
    modelReply = () => good([ANSWER, `${ANSWER.toUpperCase()}`, 'see https://evil.example/x']);
    expect((await suggest(server, q, q.dreamId)).body).toEqual({ decoys: [], source: 'NONE' });
    modelReply = () => good(['Pilot', ANSWER, 'Pilot']);
    expect((await suggest(server, q, q.dreamId)).body).toEqual({
      decoys: ['Pilot'],
      source: 'AI',
    });
    for (const text of [
      'not json',
      '{"decoys":"Pilot"}',
      '{"decoys":["a","b","c","d"]}',
      '{"decoys":["a"],"x":1}',
      '{}',
    ]) {
      modelReply = () => ({ text });
      expect((await suggest(server, q, q.dreamId)).body.source).toBe('NONE');
    }
  });

  it('needs consent and a stored answer, and only the invite holder can ask', async () => {
    modelReply = () => good(['Pilot']);
    model.requests.length = 0;
    const unconsented = await quiz(server, { consent: false, answer: false });
    expect((await suggest(server, unconsented, unconsented.dreamId)).body.error?.code).toBe(
      'CONSENT_REQUIRED',
    );
    const unanswered = await quiz(server, { answer: false });
    expect((await suggest(server, unanswered, unanswered.dreamId)).status).toBe(404);
    const forged = { ...unanswered, token: 'A'.repeat(43) };
    expect((await suggest(server, forged, unanswered.dreamId)).status).toBe(404);
    expect(model.requests).toHaveLength(0);
  });
});

describe('when the remote side fails', () => {
  it('falls back, opens the circuit after three failures and probes again after the cool-down', async () => {
    const s = await boot({ METRICS_TOKEN: 'metrics-token-0123456789' });
    await setAi(s, true);
    model.requests.length = 0;
    modelReply = () => ({ status: 500 });
    const q = await quiz(s);
    for (let i = 0; i < 3; i += 1)
      expect((await suggest(s, q, q.dreamId)).body).toEqual({ decoys: [], source: 'NONE' });
    expect(model.requests).toHaveLength(3); // no retries inside a request either
    const answered = await suggest(s, q, q.dreamId);
    expect(answered.body.source).toBe('NONE');
    expect(model.requests).toHaveLength(3); // the circuit is open: nothing went out
    const text = await (
      await fetch(`${s.httpUrl}/metrics`, {
        headers: { authorization: 'Bearer metrics-token-0123456789' },
      })
    ).text();
    expect(text).toContain('qp_ai_decoys_total{result="UPSTREAM"} 3');
    expect(text).toContain('qp_ai_decoys_total{result="CIRCUIT_OPEN"} 1');
    // the error responses never repeat the remote body or the key
    expect(JSON.stringify(answered.body)).not.toContain(KEY);
  });

  it('gives up on a slow answer inside the configured deadline', async () => {
    const s = await boot({ AI_DECOYS_TIMEOUT_MS: '250' });
    await setAi(s, true);
    modelReply = () => ({ ...good(['Pilot']), delayMs: 1_500 });
    const q = await quiz(s);
    const started = Date.now();
    expect((await suggest(s, q, q.dreamId)).body).toEqual({ decoys: [], source: 'NONE' });
    expect(Date.now() - started).toBeLessThan(1_200);
  });

  it('does nothing when the flag is on but no provider is configured', async () => {
    const s = await startServer();
    servers.push(s);
    await s.db.db
      .updateTable('feature_flags')
      .set({ enabled: true })
      .where('key', 'in', ['mode.blind_quiz', 'ai.decoys'])
      .execute();
    s.built.flags.invalidate();
    model.requests.length = 0;
    const q = await quiz(s);
    expect((await suggest(s, q, q.dreamId)).body).toEqual({ decoys: [], source: 'NONE' });
    expect(model.requests).toHaveLength(0);
  });
});
