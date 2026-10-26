import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  EmailDeliveryError,
  HttpEmailSender,
  parseFrom,
  type EmailProvider,
} from '../../apps/realtime/src/auth/http-email';
import { otpEmail } from '../../apps/realtime/src/auth/email';
import { loadConfig } from '../../apps/realtime/src/config';
import { startEmailServer, type EmailServer } from '../helpers/email-server';
import { startServer, type TestServer } from '../helpers/server';

/**
 * The production mail sender against doubles that speak Resend's and Brevo's real wire contracts
 * (ADR-0012): request shape, failure modes, secrecy of codes and keys, and the whole sign-in flow
 * through the real server.
 */
const KEY = 're_test_SECRETKEY1234567890';
const FROM = 'Gusto QuizNight <giris@mail.gusto.example>';
const noSleep = () => Promise.resolve();
const providers: EmailProvider[] = ['resend', 'brevo'];

describe.each(providers)('%s wire contract', (provider) => {
  let api: EmailServer;
  beforeAll(async () => {
    api = await startEmailServer(provider, KEY);
  });
  afterAll(async () => {
    await api.close();
  });
  afterEach(() => {
    api.requests.length = 0;
  });
  const sender = (extra: Partial<ConstructorParameters<typeof HttpEmailSender>[0]> = {}) =>
    new HttpEmailSender({
      provider,
      apiKey: KEY,
      from: FROM,
      apiBase: api.url,
      sleep: noSleep,
      ...extra,
    });

  it('delivers the Turkish and the English sign-in mail in the provider wire shape', async () => {
    const mail = sender();
    await mail.send(otpEmail('owner@example.com', '123456', 'tr'));
    await mail.send(otpEmail('owner@example.com', '654321', 'en'));
    expect(api.requests.map((r) => r.mail.subject)).toEqual([
      'QuizNight giriş kodun: 123456',
      'Your QuizNight sign-in code: 654321',
    ]);
    expect(api.requests[0]!.mail).toMatchObject({
      from: FROM,
      to: 'owner@example.com',
      text: expect.stringContaining('123456') as string,
    });
  });

  it('does not retry a rejection that a retry cannot fix (bad key, bad sender)', async () => {
    const mail = sender({ apiKey: 'wrong-key-wrong-key' });
    const error = await mail
      .send(otpEmail('a@example.com', '111111', 'tr'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).retryable).toBe(false);
    expect((error as Error).message).toMatch(/answered 401/u);
  });

  it('retries 429 and 5xx with backoff, then succeeds', async () => {
    const waits: number[] = [];
    const mail = sender({
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      backoffMs: 100,
    });
    api.failNext(429, 503);
    await mail.send(otpEmail('a@example.com', '222222', 'tr'));
    expect(waits).toEqual([100, 200]);
    expect(api.requests).toHaveLength(1);
  });

  it('gives up after the attempt limit and reports the status without body, address or key', async () => {
    const mail = sender({ maxAttempts: 2 });
    api.failNext(500, 500);
    const error = (await mail
      .send(otpEmail('victim@example.com', '333333', 'tr'))
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(/answered 500/u);
    for (const secret of [KEY, 'victim@example.com', '333333'])
      expect(JSON.stringify(error) + error.message + String(error.stack)).not.toContain(secret);
  });

  it('times out a provider that never answers and treats it as retryable', async () => {
    const mail = sender({ timeoutMs: 80, maxAttempts: 2 });
    api.stallNext(400);
    await mail.send(otpEmail('a@example.com', '444444', 'tr')); // second attempt answers
    expect(api.requests).toHaveLength(1);
  });

  it('opens the circuit after repeated outages and closes it after the cool-down', async () => {
    let now = 1_000;
    const mail = sender({
      maxAttempts: 1,
      breakerThreshold: 3,
      breakerOpenMs: 60_000,
      now: () => now,
    });
    api.failNext(500, 500, 500);
    for (let i = 0; i < 3; i++)
      await expect(mail.send(otpEmail('a@example.com', '555555', 'tr'))).rejects.toThrow(/500/u);
    expect(mail.breakerOpen).toBe(true);
    await expect(mail.send(otpEmail('a@example.com', '555555', 'tr'))).rejects.toThrow(
      /circuit open/u,
    );
    expect(api.requests).toHaveLength(0); // nothing reached the provider while open
    now += 60_001;
    await mail.send(otpEmail('a@example.com', '555555', 'tr'));
    expect(api.requests).toHaveLength(1);
  });

  it('does not count a rejected key toward the breaker (fail fast per mail instead)', async () => {
    const mail = sender({ apiKey: 'wrong-key-wrong-key', breakerThreshold: 2, maxAttempts: 1 });
    for (let i = 0; i < 4; i++)
      await mail.send(otpEmail('a@example.com', '1', 'tr')).catch(() => 0);
    expect(mail.breakerOpen).toBe(false);
  });

  it('never follows a redirect with the key attached', async () => {
    const mail = sender({
      fetch: ((_url: string, init: RequestInit) => {
        expect(init.redirect).toBe('error');
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as unknown as typeof fetch,
    });
    await mail.send(otpEmail('a@example.com', '666666', 'tr'));
  });
});

describe('sender address and configuration', () => {
  it('reads bare and named senders', () => {
    expect(parseFrom('a@b.co')).toEqual({ name: null, email: 'a@b.co' });
    expect(parseFrom('Gusto <a@b.co>')).toEqual({ name: 'Gusto', email: 'a@b.co' });
    expect(parseFrom('"Gusto Café" <a@b.co>')).toEqual({ name: 'Gusto Café', email: 'a@b.co' });
    expect(parseFrom('not an address')).toBeNull();
  });

  const production = {
    NODE_ENV: 'production',
    SERVER_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://u:p@db/qp',
    PUBLIC_WEB_URL: 'https://quiz.example.test',
    ALLOWED_ORIGINS: 'https://quiz.example.test',
  };
  it('needs provider, key and sender together, and not alongside the webhook', () => {
    const full = { EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: KEY, EMAIL_FROM: FROM };
    expect(loadConfig({ ...production, ...full }).emailProvider).toMatchObject({
      provider: 'resend',
      from: FROM,
    });
    expect(loadConfig(production).emailProvider).toBeNull();
    expect(() => loadConfig({ ...production, EMAIL_PROVIDER: 'resend' })).toThrow(/go together/u);
    expect(() => loadConfig({ ...production, ...full, EMAIL_FROM: 'nonsense' })).toThrow(
      /EMAIL_FROM/u,
    );
    expect(() => loadConfig({ ...production, ...full, EMAIL_PROVIDER: 'sendgrid' })).toThrow(
      /EMAIL_PROVIDER/u,
    );
    expect(() =>
      loadConfig({ ...production, ...full, EMAIL_WEBHOOK_URL: 'https://hook.example.test/x' }),
    ).toThrow(/not both/u);
    expect(() =>
      loadConfig({ ...production, ...full, EMAIL_API_BASE: 'https://evil.example' }),
    ).toThrow(/EMAIL_API_BASE/u);
  });
});

describe.each(providers)('sign-in end to end through the server with %s', (provider) => {
  let api: EmailServer;
  let server: TestServer;
  const logs: string[] = [];
  const email = 'owner@gusto.example';
  beforeAll(async () => {
    api = await startEmailServer(provider, KEY);
    server = await startServer({
      logStream: { write: (line) => void logs.push(line) },
      env: {
        ADMIN_BOOTSTRAP_EMAILS: email,
        EMAIL_PROVIDER: provider,
        EMAIL_API_KEY: KEY,
        EMAIL_FROM: FROM,
        EMAIL_API_BASE: api.url,
        LOG_LEVEL: 'debug',
      },
    });
  });
  afterAll(async () => {
    await server.dispose();
    await api.close();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${server.httpUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  };

  it('mails the code through the provider, the code signs the owner in as administrator, and nothing leaks into the log', async () => {
    expect((await post('/v1/auth/email/request', { email })).status).toBe(202);
    await until(() => api.requests.length > 0);
    const mail = api.requests[0]!.mail;
    const code = /\b(\d{6})\b/u.exec(mail.subject)![1]!;
    expect(mail.to).toBe(email);
    const verify = await post('/v1/auth/email/verify', { email, code, client: 'ADMIN' });
    expect(verify.status).toBe(200);
    expect(verify.headers.get('set-cookie')).toContain('HttpOnly');
    const wrong = await post('/v1/auth/email/verify', {
      email,
      code: code === '000000' ? '000001' : '000000',
      client: 'ADMIN',
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const log = logs.join('\n');
    expect(log).not.toContain(KEY);
    expect(log).not.toContain(code);
  });

  it('a provider outage never changes what the asker sees, and is logged without secrets', async () => {
    api.requests.length = 0;
    api.failNext(500, 500, 500);
    const other = 'someone@example.com';
    expect((await post('/v1/auth/email/request', { email: other })).status).toBe(202);
    await until(() => logs.some((l) => /answered 500/u.test(l)));
    expect(logs.join('\n')).toMatch(/answered 500/u);
    expect(logs.join('\n')).not.toContain(KEY);
    expect(logs.join('\n')).not.toContain(other);
  });
});
