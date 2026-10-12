import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../../apps/realtime/src/auth/accounts';
import { CSRF_HEADER, SESSION_COOKIE } from '../../apps/realtime/src/auth/guard';
import { LIMITS } from '../../apps/realtime/src/security/rate-limit';
import { adminApi, staff } from '../helpers/admin';
import { startServer, type TestServer } from '../helpers/server';

/**
 * ATTACK 18-24: break into the admin console. The route table is the specification: this test walks
 * every route the server registered, so a new endpoint is attacked the day it appears.
 */
/** `server` has relaxed limits so a scripted walk over every route is not throttled; `strict` has production limits. */
let server: TestServer;
let strict: TestServer;
beforeAll(async () => {
  server = await startServer({ seed: false });
  strict = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '1' } });
});
afterAll(async () => {
  await Promise.all([server.dispose(), strict.dispose()]);
});

const adminRoutes = () => server.built.routes.filter((route) => route.auth === 'admin');
const safe = (method: string): boolean => method === 'GET' || method === 'HEAD';
const fill = (url: string): string =>
  url
    .replace(':playerId', 'player-1')
    .replace(':key', 'report.questions')
    .replace(':code', 'ABCDEF')
    .replace(/:id/gu, randomUUID());

async function call(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
) {
  const response = await fetch(`${server.httpUrl}${fill(url)}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

describe('ATTACK 18 — the route table is the access policy', () => {
  it('knows its public surface: a new public route has to be added here on purpose', () => {
    const inventory = server.built.routes
      .filter((route) => route.auth !== 'admin')
      .map((route) => `${route.method} ${route.url} [${route.auth}]`)
      .sort();
    expect(inventory).toEqual(
      [
        'GET /healthz [public]',
        'GET /readyz [public]',
        'GET /metrics [metrics-token]',
        'GET /v1/config [public]',
        'POST /v1/rooms [public]',
        'GET /v1/flags [public]',
        'GET /v1/categories [public]',
        'GET /v1/rooms/:code/preview [public]',
        'POST /v1/auth/email/request [public]',
        'POST /v1/auth/email/verify [public]',
        'GET /v1/me [session]',
        'POST /v1/auth/logout [session]',
      ].sort(),
    );
  });

  it('gives every admin route roles and a rate limit, and every limit exists', () => {
    expect(adminRoutes().length).toBeGreaterThan(35);
    for (const route of server.built.routes) {
      if (route.limit !== 'none') expect(Object.keys(LIMITS)).toContain(route.limit);
      if (route.auth === 'admin') {
        expect(route.roles.length, `${route.method} ${route.url}`).toBeGreaterThan(0);
        expect(['adminRead', 'adminWrite', 'adminHeavy']).toContain(route.limit);
        // reads are reads: a GET never carries a write-grade policy by accident, and the reverse
        if (safe(route.method)) expect(route.limit).not.toBe('adminWrite');
        else expect(route.limit).not.toBe('adminRead');
      }
    }
  });

  it('refuses every admin route without credentials, with junk, and with credentials in the wrong place', async () => {
    for (const route of adminRoutes()) {
      const label = `${route.method} ${route.url}`;
      const attempts: Record<string, string>[] = [
        {},
        { authorization: 'Bearer ' },
        { authorization: `Bearer ${'z'.repeat(43)}` },
        { authorization: 'Basic YWRtaW46YWRtaW4=' },
        { cookie: `${SESSION_COOKIE}=${'q'.repeat(43)}` },
        { 'x-forwarded-user': 'admin', 'x-admin': '1', 'x-role': 'ADMIN' },
      ];
      for (const headers of attempts) {
        const result = await call(
          route.method,
          route.url,
          headers,
          safe(route.method) ? undefined : {},
        );
        expect({ label, status: result.status }).toEqual({ label, status: 401 });
      }
    }
  });

  it('holds each role to exactly its routes', async () => {
    const people = new Map<Role, Awaited<ReturnType<typeof staff>>>();
    for (const role of ROLES) people.set(role, await staff(server, [role]));
    for (const route of adminRoutes()) {
      for (const role of ROLES) {
        const who = people.get(role)!;
        const result = await call(
          route.method,
          route.url,
          { authorization: `Bearer ${who.token}` },
          safe(route.method) ? undefined : {},
        );
        const label = `${role} ${route.method} ${route.url}`;
        if (route.roles.includes(role)) {
          // let in: whatever the route says about an empty request, it is not "forbidden" or "unauthorised"
          expect({ label, status: result.status }).toEqual({
            label,
            status: expect.not.stringMatching(/^(401|403)$/u) as unknown,
          });
        } else {
          expect({ label, status: result.status }).toEqual({ label, status: 403 });
        }
      }
    }
  });

  it('gives staff roles to short sessions only: a long-lived session of an administrator reaches nothing', async () => {
    const longLived = await staff(server, ['ADMIN'], 'WEB');
    const mobile = await staff(server, ['ADMIN'], 'MOBILE');
    for (const route of adminRoutes())
      for (const who of [longLived, mobile])
        expect({
          route: `${route.method} ${route.url}`,
          status: (
            await call(
              route.method,
              route.url,
              { authorization: `Bearer ${who.token}` },
              safe(route.method) ? undefined : {},
            )
          ).status,
        }).toEqual({ route: `${route.method} ${route.url}`, status: 403 });
  });
});

describe("ATTACK 19 — make the administrator's own browser do it (CSRF)", () => {
  it('refuses every state change that arrives by cookie without proof it came from our page', async () => {
    const boss = await staff(server, ['ADMIN']);
    const cookie = `${SESSION_COOKIE}=${boss.token}`;
    const origin = 'http://localhost:5173';
    const hostile: Record<string, string>[] = [
      { cookie },
      { cookie, origin },
      { cookie, [CSRF_HEADER]: '1' },
      { cookie, origin: 'https://evil.example', [CSRF_HEADER]: '1' },
      { cookie, origin: 'null', [CSRF_HEADER]: '1' },
      { cookie, origin: 'http://localhost:5173.evil.example', [CSRF_HEADER]: '1' },
      { cookie, referer: `${origin}/admin`, [CSRF_HEADER]: '1' },
    ];
    for (const route of adminRoutes().filter((r) => !safe(r.method)))
      for (const headers of hostile)
        expect({
          route: `${route.method} ${route.url}`,
          status: (await call(route.method, route.url, headers, {})).status,
        }).toEqual({ route: `${route.method} ${route.url}`, status: 403 });
    // …while the real page, which can set both, gets through to the route's own validation.
    const real = await call(
      'PUT',
      '/v1/admin/flags/:key',
      { cookie, origin, [CSRF_HEADER]: '1' },
      {},
    );
    expect(real.status).toBe(400);
  });

  it('does not take a session from the address bar or from an invented header', async () => {
    const boss = await staff(server, ['ADMIN']);
    for (const suffix of [
      `?token=${boss.token}`,
      `?access_token=${boss.token}`,
      `?session=${boss.token}`,
    ]) {
      expect((await call('GET', `/v1/admin/stats${suffix}`)).status).toBe(401);
    }
    for (const header of ['x-auth-token', 'x-session', 'x-api-key', 'proxy-authorization']) {
      expect((await call('GET', '/v1/admin/stats', { [header]: boss.token })).status).toBe(401);
    }
    // method tunnelling cannot turn a read into a write or a lesser role into a greater one
    const editor = await staff(server, ['EDITOR']);
    const tunnelled = await call('GET', '/v1/admin/users', {
      authorization: `Bearer ${editor.token}`,
      'x-http-method-override': 'PUT',
    });
    expect(tunnelled.status).toBe(403);
  });
});

describe('ATTACK 20 — climb: roles, mass assignment, ids', () => {
  it('stops an editor from making themselves more, however the request is dressed', async () => {
    const editor = await staff(server, ['EDITOR']);
    const api = adminApi(server, editor);
    for (const body of [
      { roles: ['ADMIN'] },
      { roles: ['ADMIN'], accountId: editor.accountId },
      { roles: 'ADMIN' },
      { __proto__: { admin: true }, roles: ['ADMIN'] },
    ]) {
      expect([403]).toContain(
        (await api.put(`/v1/admin/users/${editor.accountId}/roles`, body)).status,
      );
    }
    const me = await api.get<{ account: { roles: string[] } }>('/v1/me');
    expect(me.body.account.roles).toEqual(['EDITOR']);
  });

  it('ignores every field an endpoint did not declare, by refusing the request', async () => {
    const boss = await staff(server, ['ADMIN']);
    const targets = [
      ['PATCH', `/v1/admin/questions/${randomUUID()}`, { expectedRevision: 1 }],
      [
        'POST',
        `/v1/admin/questions/${randomUUID()}/transition`,
        { to: 'REVIEW', reason: 'because' },
      ],
      ['POST', '/v1/admin/incidents', { title: 'abc', severity: 'LOW' }],
      ['PATCH', '/v1/admin/categories/history', { enabled: true }],
      ['PUT', '/v1/admin/flags/report.questions', { enabled: true }],
      ['POST', `/v1/admin/users/${randomUUID()}/status`, { status: 'ACTIVE' }],
    ] as const;
    const extras: Record<string, unknown> = {
      isAdmin: true,
      role: 'ADMIN',
      is_dev_seed: true,
      author_type: 'DEV_SEED',
      revision: 99,
      id: randomUUID(),
      roles: ['ADMIN'],
    };
    const send = async (method: string, path: string, raw: string): Promise<number> => {
      const response = await fetch(`${server.httpUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${boss.token}`, 'content-type': 'application/json' },
        body: raw,
      });
      await response.text();
      return response.status;
    };
    for (const [method, path, base] of targets) {
      for (const [key, value] of Object.entries(extras)) {
        if (key in base) continue; // that one is a field the route declares
        const status = await send(method, path, JSON.stringify({ ...base, [key]: value }));
        expect({ path, key, status }).toEqual({ path, key, status: 400 });
      }
      // prototype keys only exist when written as raw JSON (an object literal would swallow them)
      for (const key of ['__proto__', 'constructor', 'prototype']) {
        const raw = `${JSON.stringify(base).slice(0, -1)},"${key}":{"admin":true}}`;
        const status = await send(method, path, raw);
        expect({ path, key, status }).toEqual({ path, key, status: 400 });
      }
    }
  });

  it("never trusts an id: strangers' ids, wrong shapes and traversal all end as 400 or 404", async () => {
    const boss = await staff(server, ['ADMIN']);
    const api = adminApi(server, boss);
    for (const id of [
      '0',
      'null',
      '../../etc/passwd',
      '%2e%2e%2f',
      "' OR '1'='1",
      'x'.repeat(5000),
      randomUUID().toUpperCase(),
      randomUUID(),
    ]) {
      for (const path of [
        '/v1/admin/questions/',
        '/v1/admin/rooms/',
        '/v1/admin/incidents/',
        '/v1/admin/bans/',
      ]) {
        const result = await api.call('GET', `${path}${encodeURIComponent(id)}`);
        expect([400, 404], `${path}${id.slice(0, 30)} → ${result.status}`).toContain(result.status);
      }
    }
  });
});

describe('ATTACK 21 — feed it garbage (injection, bombs, prototype tricks)', () => {
  it('survives injection strings in every query parameter of every list endpoint', async () => {
    const boss = await staff(server, ['ADMIN']);
    const api = adminApi(server, boss);
    const payloads = [
      "' OR 1=1 --",
      "'; DROP TABLE questions; --",
      '%',
      '_',
      '\\',
      '\u0000',
      '${7*7}',
      '{{7*7}}',
      '<script>alert(1)</script>',
      'a'.repeat(3000),
      '𝒜'.repeat(50),
      '../..',
    ];
    const listPaths = [
      [
        '/v1/admin/questions',
        ['status', 'category', 'language', 'pool', 'difficulty', 'q', 'sort', 'limit', 'offset'],
      ],
      ['/v1/admin/queue', ['status', 'category', 'reason', 'limit', 'offset']],
      ['/v1/admin/reports', ['status', 'reason', 'questionId', 'limit', 'offset']],
      ['/v1/admin/bans', ['open', 'limit', 'offset']],
      ['/v1/admin/incidents', ['status', 'limit', 'offset']],
      ['/v1/admin/security-events', ['kind', 'limit', 'offset']],
      ['/v1/admin/users', ['search', 'role', 'limit', 'offset']],
      ['/v1/admin/audit-log', ['actor', 'action', 'targetType', 'targetId', 'limit', 'offset']],
      ['/v1/admin/export', ['format', 'status', 'category', 'limit']],
    ] as const;
    for (const [path, params] of listPaths)
      for (const param of params)
        for (const payload of payloads) {
          const result = await api.call('GET', `${path}?${param}=${encodeURIComponent(payload)}`);
          expect(result.status, `${path}?${param}=${payload.slice(0, 20)}`).toBeLessThan(500);
        }
    // the tables are all still there and a search term is a term, not a pattern
    const questions = await api.get<{ total: number }>('/v1/admin/questions?q=%25');
    expect(questions.body.total).toBe(0);
    expect((await api.get('/v1/admin/stats')).status).toBe(200);
  });

  it('survives hostile JSON bodies on every write route without a server error or a side effect', async () => {
    const boss = await staff(server, ['ADMIN']);
    const deep = `${'['.repeat(3000)}${']'.repeat(3000)}`;
    const bodies: string[] = [
      'null',
      '[]',
      '"text"',
      '12',
      'true',
      '{"__proto__":{"isAdmin":true}}',
      '{"constructor":{"prototype":{"x":1}}}',
      deep,
      `{"a":${deep}}`,
      '{"a":',
      `{"x":"${'y'.repeat(200_000)}"}`,
      '\u0000',
    ];
    const before = await server.db.db
      .selectFrom('admin_audit')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    for (const route of adminRoutes().filter((r) => !safe(r.method))) {
      for (const raw of bodies) {
        const response = await fetch(`${server.httpUrl}${fill(route.url)}`, {
          method: route.method,
          headers: { authorization: `Bearer ${boss.token}`, 'content-type': 'application/json' },
          body: raw,
        });
        await response.text();
        expect({ route: `${route.method} ${route.url}`, ok: response.status < 500 }).toEqual({
          route: `${route.method} ${route.url}`,
          ok: true,
        });
      }
    }
    const polluted = ({} as Record<string, unknown>).isAdmin;
    expect(polluted).toBeUndefined();
    const after = await server.db.db
      .selectFrom('admin_audit')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n)); // nothing was changed, so nothing was recorded
  });

  it('stops import bombs: a huge body, too many rows, endless lines, absurd cells', async () => {
    const editor = await staff(server, ['EDITOR']);
    const api = adminApi(server, editor);
    const huge = await api.post('/v1/admin/questions/import', {
      format: 'jsonl',
      text: 'x'.repeat(8 * 1024 * 1024),
    });
    expect([400, 413]).toContain(huge.status);
    const many = await api.post<{ error: { code: string } }>('/v1/admin/questions/import', {
      format: 'jsonl',
      text: Array.from({ length: 6000 }, () => '{}').join('\n'),
    });
    expect(many.status).toBe(413);
    expect(many.body.error.code).toBe('TOO_MANY_ROWS');
    const longLine = await api.post<{ counts: Record<string, number> }>(
      '/v1/admin/questions/import',
      { format: 'jsonl', text: JSON.stringify({ question: 'a'.repeat(2_000_000) }) },
    );
    expect(longLine.status).toBeLessThan(500);
    const wideCsv = await api.post('/v1/admin/questions/import', {
      format: 'csv',
      text: `${Array.from({ length: 100_000 }, (_, i) => `c${i}`).join(',')}\n${Array.from({ length: 100_000 }, () => 'v').join(',')}`,
    });
    expect(wideCsv.status).toBeLessThan(500);
    const rows = await server.db.db
      .selectFrom('questions')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(rows.n)).toBe(0);
  });

  it('keeps stored markup inert: data is data, and responses cannot be sniffed into a page', async () => {
    const editor = await staff(server, ['EDITOR']);
    const api = adminApi(server, editor);
    await server.db.db
      .insertInto('categories')
      .values({ id: 'general', label_tr: 'G', label_en: 'G' })
      .onConflict((c) => c.doNothing())
      .execute();
    const created = await api.post<{ item: { outcome: string; questionId?: string } }>(
      '/v1/admin/questions',
      {
        question: {
          externalId: 'xss-1',
          category: 'general',
          difficulty: 'EASY',
          question:
            '=HYPERLINK("http://kotu.example","tıkla") <script>alert(1)</script> hangisidir?',
          options: ['<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', 'Üç', 'Dört'],
          correctIndex: 2,
          authorType: 'HUMAN',
        },
      },
    );
    expect([201, 422]).toContain(created.status);
    for (const path of [
      '/v1/admin/questions',
      '/v1/admin/stats',
      '/v1/admin/export?format=csv&status=DRAFT,REVIEW,REJECTED',
    ]) {
      const result = await api.call('GET', path);
      expect(result.headers.get('x-content-type-options')).toBe('nosniff');
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(result.headers.get('content-security-policy')).toContain("default-src 'none'");
    }
    const csv = await api.call('GET', '/v1/admin/export?format=csv&status=DRAFT,REVIEW,REJECTED');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('attachment');
    for (const line of csv.text.split('\r\n').slice(1))
      expect(line).not.toMatch(/(^|,)=HYPERLINK/u);
  });
});

describe('ATTACK 22 — guess the sign-in', () => {
  it('limits guessing a code per mailbox however many addresses the guesses come from', async () => {
    const email = `target-${randomUUID().slice(0, 6)}@example.com`;
    await fetch(`${strict.httpUrl}/v1/auth/email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const response = await fetch(`${strict.httpUrl}/v1/auth/email/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: String(100_000 + i) }),
      });
      statuses.push(response.status);
    }
    // ten tries of any kind, then the mailbox is cooled down; no try ever signed anyone in
    expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(401));
    expect(statuses.slice(10)).toEqual(Array<number>(4).fill(429));
    expect(await strict.db.db.selectFrom('account_sessions').select('id').execute()).toEqual([]);
    // the code itself was dead after five wrong attempts, whatever happens to the limiter
    const row = await strict.db.db
      .selectFrom('email_otps')
      .select('attempts')
      .executeTakeFirstOrThrow();
    expect(row.attempts).toBe(5);
  });

  it('answers a wrong code and a nonexistent mailbox identically, down to the headers', async () => {
    const answer = async (email: string) => {
      const response = await fetch(`${server.httpUrl}/v1/auth/email/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: '123456' }),
      });
      return {
        status: response.status,
        body: await response.text(),
        type: response.headers.get('content-type'),
        length: response.headers.get('content-length'),
      };
    };
    const known = `known-${randomUUID().slice(0, 6)}@example.com`;
    await fetch(`${server.httpUrl}/v1/auth/email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: known }),
    });
    expect(await answer(known)).toEqual(
      await answer(`nobody-${randomUUID().slice(0, 6)}@example.com`),
    );
  });
});

describe('ATTACK 23 — keep a session that should be dead', () => {
  it("stops a revoked token, a suspended account's token and a signed-out token at once", async () => {
    const victim = await staff(server, ['MODERATOR']);
    const api = adminApi(server, victim);
    expect((await api.get('/v1/admin/queue')).status).toBe(200);
    await server.built.accountSessions.revokeAll(victim.accountId);
    expect((await api.get('/v1/admin/queue')).status).toBe(401);

    const other = await staff(server, ['EDITOR']);
    await server.built.accounts.setStatus(other.accountId, 'SUSPENDED');
    expect((await adminApi(server, other).get('/v1/admin/queue')).status).toBe(401);

    const third = await staff(server, ['EDITOR']);
    expect(
      (
        await fetch(`${server.httpUrl}/v1/auth/logout`, {
          method: 'POST',
          headers: { authorization: `Bearer ${third.token}` },
        })
      ).status,
    ).toBe(200);
    expect((await adminApi(server, third).get('/v1/admin/queue')).status).toBe(401);
  });

  it('takes a role away with immediate effect on a live session', async () => {
    const mod = await staff(server, ['MODERATOR']);
    const api = adminApi(server, mod);
    expect((await api.get('/v1/admin/queue')).status).toBe(200);
    await server.built.accounts.setRoles(mod.accountId, ['SUPPORT'], mod.accountId);
    expect((await api.get('/v1/admin/queue')).status).toBe(403);
    expect((await api.get('/v1/admin/rooms')).status).toBe(200);
  });
});

describe('ATTACK 24 — hammer the console', () => {
  it('rate-limits a signed-in caller per account, reads and writes apart, without hurting the others', async () => {
    const noisy = await staff(strict, ['ADMIN']);
    const quiet = await staff(strict, ['ADMIN']);
    const api = adminApi(strict, noisy);
    const writes: number[] = [];
    for (let i = 0; i < 90; i++)
      writes.push((await api.put('/v1/admin/flags/report.questions', { enabled: true })).status);
    expect(writes).toContain(429);
    expect(writes.every((s) => s === 200 || s === 429)).toBe(true);
    expect(
      (await adminApi(strict, quiet).put('/v1/admin/flags/report.questions', { enabled: true }))
        .status,
    ).toBe(200);
  });
});
