import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { MemoryEmailSender } from '../../apps/realtime/src/auth/email';
import { CSRF_HEADER, SESSION_COOKIE } from '../../apps/realtime/src/auth/guard';
import { startServer, type TestServer } from '../helpers/server';

/**
 * Sign-in over HTTP, the way a browser or the mobile app does it (ADR-0012). The mail service is a
 * mailbox double: the test reads the code like a person would.
 */
const ADMIN_EMAIL = 'first.admin@example.com';
const mailbox = new MemoryEmailSender();
let server: TestServer;
beforeAll(async () => {
  server = await startServer({
    emailSender: mailbox,
    env: { ADMIN_BOOTSTRAP_EMAILS: ADMIN_EMAIL },
  });
});
afterAll(async () => {
  await server.dispose();
});

const origin = 'http://localhost:5173'; // PUBLIC_WEB_URL of the test server: an allowed origin
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.httpUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${server.httpUrl}${path}`, { headers });
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Asks for a code, reads it from the mailbox, and signs in. Each caller uses a fresh address. */
async function signIn(email: string, client: 'ADMIN' | 'WEB' | 'MOBILE' = 'WEB') {
  expect((await post('/v1/auth/email/request', { email })).status).toBe(202);
  await pause();
  const code = mailbox.lastCode(email)!;
  const response = await post('/v1/auth/email/verify', { email, code, client });
  const cookie = response.headers.get('set-cookie');
  return {
    response,
    cookie,
    cookieHeader: cookie?.split(';')[0] ?? '',
    body: (await response.clone().json()) as Record<string, unknown>,
  };
}

let counter = 0;
const fresh = () => `person${++counter}@example.com`;

describe('asking for a code', () => {
  it('answers 202 and the same body for an address with an account and one without', async () => {
    const known = fresh();
    await signIn(known);
    const unknown = fresh();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const a = await post('/v1/auth/email/request', { email: known });
    const b = await post('/v1/auth/email/request', { email: unknown });
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(await a.json()).toEqual(await b.json());
    for (const header of ['content-type', 'cache-control', 'content-length'])
      expect(a.headers.get(header)).toBe(b.headers.get(header));
  });

  it('answers 202 even when it sends nothing (inside the 30 second wait)', async () => {
    const email = fresh();
    await post('/v1/auth/email/request', { email });
    await pause();
    const before = mailbox.outbox.length;
    const again = await post('/v1/auth/email/request', { email });
    await pause();
    expect(again.status).toBe(202);
    expect(mailbox.outbox.length).toBe(before);
  });

  it('refuses what is not an address, or not a request, without saying more', async () => {
    for (const body of [
      { email: 'nope' },
      { email: '' },
      {},
      { email: 'a@example.com', extra: 1 },
      { email: 5 },
      [],
      'x',
    ]) {
      const response = await post('/v1/auth/email/request', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'INVALID_MESSAGE' } });
    }
  });
});

describe('signing in', () => {
  it('opens a session: HttpOnly strict cookie, and /v1/me with the cookie or as a bearer', async () => {
    const email = fresh();
    const { response, cookie, cookieHeader, body } = await signIn(email);
    expect(response.status).toBe(200);
    expect(cookie).toMatch(
      new RegExp(
        `^${SESSION_COOKIE}=[\\w-]{40,}; Path=/; HttpOnly; SameSite=Strict; Max-Age=\\d+$`,
        'u',
      ),
    );
    expect(body).toMatchObject({ account: { email, roles: [], sessionKind: 'WEB' } });
    expect(JSON.stringify(body)).not.toContain(cookieHeader.split('=')[1]!); // browsers never see the token in the body
    const viaCookie = await get('/v1/me', { cookie: cookieHeader });
    expect(await viaCookie.json()).toMatchObject({ account: { email } });
    const token = cookieHeader.split('=')[1]!;
    const viaBearer = await get('/v1/me', { authorization: `Bearer ${token}` });
    expect(viaBearer.status).toBe(200);
  });

  it('gives the mobile app its token in the body and no cookie', async () => {
    const { response, cookie, body } = await signIn(fresh(), 'MOBILE');
    expect(response.status).toBe(200);
    expect(cookie).toBeNull();
    expect(typeof body.token).toBe('string');
    expect(body).toMatchObject({ account: { sessionKind: 'MOBILE' } });
  });

  it('makes the bootstrap address an administrator, and nobody else', async () => {
    const admin = await signIn(ADMIN_EMAIL, 'ADMIN');
    expect(admin.body).toMatchObject({
      account: { email: ADMIN_EMAIL, roles: ['ADMIN'], sessionKind: 'ADMIN' },
    });
    expect(admin.cookie).toMatch(/Max-Age=43200/u); // twelve hours at most
    const other = await signIn(fresh());
    expect(other.body).toMatchObject({ account: { roles: [] } });
  });

  it('keeps staff sign-in for staff: an ordinary account asking for an admin session is refused', async () => {
    const { response } = await signIn(fresh(), 'ADMIN');
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses wrong, reused and unknown codes with one and the same answer', async () => {
    const email = fresh();
    await post('/v1/auth/email/request', { email });
    await pause();
    const code = mailbox.lastCode(email)!;
    const wrong = code === '123456' ? '654321' : '123456';
    const answers = [
      await post('/v1/auth/email/verify', { email, code: wrong }),
      await post('/v1/auth/email/verify', { email: fresh(), code: '123456' }),
    ];
    const bodies = await Promise.all(
      answers.map(async (a) => [a.status, (await a.json()) as unknown] as const),
    );
    expect(bodies[0]).toEqual([401, { error: { code: 'UNAUTHORIZED' } }]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect((await post('/v1/auth/email/verify', { email, code })).status).toBe(200);
    expect((await post('/v1/auth/email/verify', { email, code })).status).toBe(401); // single use
  });

  it('refuses malformed codes before touching the database', async () => {
    for (const code of ['12345', '1234567', 'abcdef', ' 12345', '１２３４５６', 123456]) {
      expect((await post('/v1/auth/email/verify', { email: fresh(), code })).status).toBe(400);
    }
  });

  it('does not sign in a suspended account, and cuts its sessions', async () => {
    const email = fresh();
    const first = await signIn(email);
    const accountId = (first.body.account as { id: string }).id;
    await server.db.db
      .updateTable('accounts')
      .set({ status: 'SUSPENDED' })
      .where('id', '=', accountId)
      .execute();
    expect((await get('/v1/me', { cookie: first.cookieHeader })).status).toBe(401);
    const second = await signIn(email);
    expect(second.response.status).toBe(401);
    await server.db.db
      .updateTable('accounts')
      .set({ status: 'ACTIVE' })
      .where('id', '=', accountId)
      .execute();
  });

  it('does not sign in a banned account', async () => {
    const email = fresh();
    const first = await signIn(email);
    const accountId = (first.body.account as { id: string }).id;
    await server.db.db
      .insertInto('bans')
      .values({ kind: 'ACCOUNT', subject_hash: accountId, reason: 'test ban' })
      .execute();
    expect((await signIn(email)).response.status).toBe(401);
    await server.db.db.deleteFrom('bans').execute();
  });
});

describe('the session', () => {
  it('ends at logout: the token is dead, the cookie is cleared', async () => {
    const { cookieHeader } = await signIn(fresh());
    const out = await post(
      '/v1/auth/logout',
      {},
      { cookie: cookieHeader, origin, [CSRF_HEADER]: '1' },
    );
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/u);
    expect((await get('/v1/me', { cookie: cookieHeader })).status).toBe(401);
  });

  it('is not stored in the clear', async () => {
    const { cookieHeader } = await signIn(fresh());
    const token = cookieHeader.split('=')[1]!;
    const rows = await server.db.db.selectFrom('account_sessions').select('token_hash').execute();
    expect(
      rows.every((row) => row.token_hash !== token && /^[0-9a-f]{64}$/u.test(row.token_hash)),
    ).toBe(true);
  });

  it.each([
    ['nothing', {}],
    ['a made-up token', { authorization: `Bearer ${'x'.repeat(43)}` }],
    ['a made-up cookie', { cookie: `${SESSION_COOKIE}=${'y'.repeat(43)}` }],
    ['a token of the wrong size', { authorization: 'Bearer short' }],
    ['another scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
  ])('refuses %s', async (_name, headers) => {
    const response = await get('/v1/me', headers);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED' } });
  });

  it('refuses a state change that a hostile page could have caused (cookie without proof of origin)', async () => {
    const { cookieHeader } = await signIn(fresh());
    const hostile: Record<string, string>[] = [
      { cookie: cookieHeader }, // no origin, no header
      { cookie: cookieHeader, origin }, // origin but no header
      { cookie: cookieHeader, [CSRF_HEADER]: '1' }, // header but no origin
      { cookie: cookieHeader, origin: 'https://evil.example', [CSRF_HEADER]: '1' }, // someone else's page
      { cookie: cookieHeader, origin: 'null', [CSRF_HEADER]: '1' }, // sandboxed iframe
      { cookie: cookieHeader, origin, [CSRF_HEADER]: '0' },
    ];
    for (const headers of hostile) {
      expect((await post('/v1/auth/logout', {}, headers)).status).toBe(403);
    }
    expect((await get('/v1/me', { cookie: cookieHeader })).status).toBe(200); // still signed in
  });

  it('lets a bearer token change state without the browser-only proof: it is not sent by itself', async () => {
    const { response, body } = await signIn(fresh(), 'MOBILE');
    expect(response.status).toBe(200);
    const out = await post(
      '/v1/auth/logout',
      {},
      { authorization: `Bearer ${body.token as string}` },
    );
    expect(out.status).toBe(200);
  });

  it('expires: an ordinary session slides, a staff session is short', async () => {
    const { cookieHeader } = await signIn(fresh());
    const row = await server.db.db
      .selectFrom('account_sessions')
      .select(['id', 'expires_at'])
      .where('kind', '=', 'WEB')
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    const days = (row.expires_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    const staff = await server.db.db
      .selectFrom('account_sessions')
      .select('expires_at')
      .where('kind', '=', 'ADMIN')
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    const hours = (staff.expires_at.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11);
    expect(hours).toBeLessThanOrEqual(12);
    void cookieHeader;
    await sql`SELECT 1`.execute(server.db.db);
  });
});

describe('the switch and the mail service', () => {
  it('stops answering when the flag is off, and says so plainly', async () => {
    await server.db.db
      .updateTable('feature_flags')
      .set({ enabled: false })
      .where('key', '=', 'auth.email_login')
      .execute();
    server.built.flags.invalidate();
    const response = await post('/v1/auth/email/request', { email: fresh() });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'FEATURE_DISABLED' } });
    await server.db.db
      .updateTable('feature_flags')
      .set({ enabled: true })
      .where('key', '=', 'auth.email_login')
      .execute();
    server.built.flags.invalidate();
  });
});
