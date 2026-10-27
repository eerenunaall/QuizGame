import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv, VENUE_CSV_HEADER, VENUE_CSV_TEMPLATE } from '@quizparty/question-schema';
import { submitReport } from '@quizparty/question-bank';
import { containsProfanity } from '@quizparty/validation';
import { adminApi, staff as adminStaff } from '../helpers/admin';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import {
  contentApi,
  makeVenue,
  person,
  seedVenueQuestions,
  setVenueFlag,
  toBase64,
  type VenueFixture,
} from '../helpers/venue';

/**
 * ATTACK 37 — a café's own questions (venue question sets, ADR-0025). The upload is the first place where
 * a stranger's bytes become content that other people read on a TV: every route is walked as a stranger,
 * as staff, as another venue's owner and as an admin-console session; hostile files, floods and Unicode
 * tricks are thrown at the importer; the export is read the way a spreadsheet would; reports travel to
 * the owner and the admins; and nothing of one venue shows up in another's, or the public, surface.
 */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
let uploadA: string;
beforeAll(async () => {
  server = await startServer({ env: { RATE_LIMIT_SCALE: '1000' } });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
  const imported = await contentApi(server, a.owner, a.venueId).import(VENUE_CSV_TEMPLATE, 'a.csv');
  uploadA = imported.body.uploadId;
});
afterAll(async () => {
  await server.dispose();
});

const api = (who: { token: string } | null, venue = a) => contentApi(server, who, venue.venueId);
const rows = (venueId: string) =>
  server.db.db.selectFrom('questions').selectAll().where('owner_venue_id', '=', venueId).execute();
const questionRoutes = () =>
  server.built.routes.filter((route) => route.url.includes('/questions'));

describe('ATTACK 37 — every question route', () => {
  it('is walked with no credentials (401), a stranger (404), the other venue (404), staff (403 but the list) and a console session (403)', async () => {
    const stranger = await person(server, 'stranger');
    const console = await adminStaff(server, ['ADMIN']);
    const routes = questionRoutes().filter((route) => route.url.startsWith('/v1/venues/:venueId'));
    expect(routes.length).toBeGreaterThanOrEqual(9);
    const before = (await rows(a.venueId)).map((row) => `${row.id}:${row.status}`).sort();
    for (const route of routes) {
      const path = route.url
        .replace(':venueId', a.venueId)
        .replace(':uploadId', uploadA)
        .replace(':reportId', a.venueId);
      const body = route.method === 'POST' ? {} : undefined;
      const send = (who: { token: string } | null, kind: 'WEB' | 'ADMIN' = 'WEB') =>
        call(server, route.method, path, {
          cookies: false,
          ...(who ? { token: who.token } : {}),
          ...(body ? { body } : {}),
          headers: kind === 'ADMIN' ? {} : {},
        });
      const label = `${route.method} ${route.url}`;
      expect((await send(null)).status, `${label} anonymous`).toBe(401);
      expect((await send(stranger)).status, `${label} stranger`).toBe(404);
      expect((await send(b.owner)).status, `${label} other venue's owner`).toBe(404);
      expect((await send(console)).status, `${label} console`).toBe(403);
      const staffAnswer = (await send(a.staff)).status;
      expect(staffAnswer, `${label} staff`).toBe(route.url.endsWith('/questions') ? 200 : 403);
    }
    expect((await rows(a.venueId)).map((row) => `${row.id}:${row.status}`).sort()).toEqual(before);
  });

  it('refuses mass assignment: no owner, venue or status in the body, and none smuggled in a row', async () => {
    const owner = api(a.owner);
    for (const extra of [
      { venueId: b.venueId },
      { ownerVenueId: b.venueId },
      { status: 'ACTIVE' },
    ]) {
      const result = await call(server, 'POST', `/v1/venues/${a.venueId}/questions/import`, {
        cookies: false,
        token: a.owner.token,
        body: { fileName: 'x.csv', data: toBase64(VENUE_CSV_TEMPLATE), ...extra },
      });
      expect(result.status).toBe(400);
    }
    const jsonl =
      JSON.stringify({
        category: 'Tarih',
        difficulty: 'EASY',
        question: 'Hangi yıl Malazgirt Savaşı yapılmıştır?',
        options: ['1071', '1176', '1243', '1453'],
        correctIndex: 0,
        owner_venue_id: b.venueId,
        status: 'ACTIVE',
        pool: 'EVERGREEN',
        externalId: 'steal-the-id',
      }) + '\n';
    const dry = await owner.dryRun(jsonl, 'x.jsonl');
    expect(dry.body.counts.invalid).toBe(1);
    expect(JSON.stringify(dry.body.rows)).toContain('unknown_field');
    expect(await rows(b.venueId)).toHaveLength(0);
  });
});

describe('ATTACK 37 — venue A against venue B', () => {
  it("B cannot list, export, retire or resolve anything of A's, by its own path or by A's", async () => {
    const own = await api(b.owner, b).import(
      VENUE_CSV_HEADER +
        '\nTarih,EASY,Bu bir deneme sorusudur değil mi?,Evet,Hayır,Belki,Hiçbiri,A,\n',
    );
    expect(JSON.stringify(own.body)).not.toContain(a.venueId);
    // A's upload id on B's own path
    expect((await api(b.owner, b).retire(uploadA)).status).toBe(404);
    expect((await api(b.owner, b).resolve(a.venueId, 'RETIRE')).status).toBe(404);
    const exported = await api(b.owner, b).raw('export');
    expect(exported.text).not.toContain('Ankara');
    expect(
      (await api(b.owner, b).list()).body.uploads.every((u: { id: string }) => u.id !== uploadA),
    ).toBe(true);
    expect((await rows(a.venueId)).every((row) => row.status === 'ACTIVE')).toBe(true);
  });

  it("A's questions and categories are in no public surface", async () => {
    const catalog = await call<{ categories: { id: string; label: string }[] }>(
      server,
      'GET',
      '/v1/categories?language=tr',
      { cookies: false },
    );
    const ids = JSON.stringify(catalog.body);
    expect(ids).not.toContain('Kutu Oyunları');
    expect(ids).not.toContain(`v${a.venueId.replace(/-/gu, '').slice(0, 8)}`);
  });
});

describe('ATTACK 37 — hostile files', () => {
  const dry = (bytes: Uint8Array | string, name = 'x.csv') => api(a.owner).dryRun(bytes, name);

  it('answers garbage, binaries and archives with a reason, never an error, never a row', async () => {
    const before = (await rows(a.venueId)).length;
    const cases: [string, Uint8Array | string][] = [
      ['random bytes', new Uint8Array(randomBytes(100_000))],
      ['a PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
      ['a gzip', new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0])],
      ['a zip named .csv', new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 8, 0])],
      ['text with NULs', 'a,b\u0000,c\n1,2,3\n'],
      ['a lone quote', '"'],
      ['whitespace', '   \n\n  '],
      ['an HTML page', '<!doctype html><html><script>alert(1)</script></html>'],
      ['a deeply nested JSON line', '{"a":'.repeat(20_000) + '1' + '}'.repeat(20_000)],
      ['a 30k-char JSONL line', JSON.stringify({ question: 'x'.repeat(30_000) })],
      [
        'one cell of 5000 characters',
        `${VENUE_CSV_HEADER}\nx,EASY,${'a'.repeat(5000)},1,2,3,4,A,\n`,
      ],
      ['a header only', VENUE_CSV_HEADER],
    ];
    for (const [label, bytes] of cases) {
      const result = await dry(bytes, label.includes('JSON') ? 'x.jsonl' : 'x.csv');
      expect(result.status, label).toBe(200);
      const body = result.body;
      const refused = body.ok === false;
      expect(refused || body.counts.ok === 0, label).toBe(true);
    }
    const imported = await api(a.owner).import(new Uint8Array(randomBytes(5000)));
    expect(imported.body.ok).toBe(false);
    expect((await rows(a.venueId)).length).toBe(before);
  });

  it('refuses a body over the limit before reading it, and a file of 2.1 MB', async () => {
    const huge = await call(server, 'POST', `/v1/venues/${a.venueId}/questions/dry-run`, {
      cookies: false,
      token: a.owner.token,
      body: { fileName: 'x', data: 'A'.repeat(4 * 1024 * 1024) },
    });
    expect(huge.status).toBe(413);
    expect((await dry('x'.repeat(2 * 1024 * 1024 + 10))).body.issue.code).toBe('file_too_large');
  });

  it('a flood of 2000 identical rows stores one question and counts the rest as duplicates', async () => {
    const venue = await makeVenue(server);
    const row = 'Tarih,EASY,Malazgirt Savaşı hangi yılda yapılmıştır?,1071,1176,1243,1453,A,\n';
    const file = VENUE_CSV_HEADER + '\n' + row.repeat(2000);
    const result = await api(venue.owner, venue).import(file);
    expect(result.body.imported).toBe(1);
    expect(result.body.analysis.counts.duplicate).toBe(1999);
    expect(await rows(venue.venueId)).toHaveLength(1);
    expect(
      (await api(venue.owner, venue).import(VENUE_CSV_HEADER + '\n' + row.repeat(2001))).body.issue
        .code,
    ).toBe('file_too_many_rows');
  });

  it('strips zero-width and bidi controls, and refuses invisible letters and hidden profanity', async () => {
    const venue = await makeVenue(server);
    const tricky = [
      VENUE_CSV_HEADER,
      // bidi override + zero-width space around ordinary words: cleaned to plain text
      'Tarih,EASY,Malazgirt\u202E Savaşı\u200B hangi yılda yapılmıştır?,1071,1176,1243,1453,A,',
      // Hangul filler hides a gap between letters
      'Tarih,EASY,Cumhuriyet\u3164 hangi yılda ilan edilmiştir?,1919,1920,1923,1938,C,',
    ];
    const swear = ['siktir', 'orospu', 'amk', 'piç'].find((word) => containsProfanity(word));
    if (swear)
      tricky.push(
        `Tarih,EASY,Bu ${swear.slice(0, 2)}\u200B${swear.slice(2)} sorusunun cevabı nedir?,Evet,Hayır,Belki,Asla,A,`,
      );
    const result = await api(venue.owner, venue).import(tricky.join('\n'));
    const stored = await rows(venue.venueId);
    for (const row of stored)
      expect(row.text).not.toMatch(/[\u202A-\u202E\u200B-\u200F\u2060-\u2069\uFEFF\u3164]/u);
    expect(stored.map((row) => row.text)).toContain('Malazgirt Savaşı hangi yılda yapılmıştır?');
    const rejected = JSON.stringify(result.body.analysis.rows);
    expect(rejected).toContain('text_forbidden_characters');
    if (swear) expect(rejected).toMatch(/text_profanity|PROFANITY/u);
    expect(stored.length).toBe(1);
  });

  it('keeps script-looking text as inert text: stored verbatim, delivered as JSON, never altered or run', async () => {
    const venue = await makeVenue(server);
    const evil = '<img src=x onerror=alert(1)> Hangisi doğrudur';
    await seedVenueQuestions(server, venue.venueId, 1, { prefix: evil });
    const exported = await api(venue.owner, venue).raw('export');
    expect(exported.text).toContain(evil);
    expect(exported.headers.get('content-type')).toContain('text/csv');
    const list = await api(venue.owner, venue).list();
    expect(list.status).toBe(200);
    // the list API is JSON; a browser does not interpret it
    const response = await fetch(`${server.httpUrl}/v1/venues/${venue.venueId}/questions`, {
      headers: { authorization: `Bearer ${venue.owner.token}` },
    });
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-content-type-options')?.toLowerCase()).toBe('nosniff');
  });
});

describe('ATTACK 37 — the export read as a spreadsheet', () => {
  it('prefixes every cell that starts with = + - @ (or a tab) so Excel cannot run it', async () => {
    const venue = await makeVenue(server);
    for (const prefix of [
      '=HYPERLINK("http://evil.example","x")',
      '+cmd|calc',
      '-2+3',
      '@SUM(A1)',
      '\tTAB',
    ])
      await seedVenueQuestions(server, venue.venueId, 1, {
        prefix,
        category: `v${venue.venueId.replace(/-/gu, '').slice(0, 8)}-ozel`,
      });
    const exported = await api(venue.owner, venue).raw('export');
    const cells = parseCsv(exported.text.replace(/^\uFEFF/u, '')).flat();
    const dangerous = cells.filter((cell) => /^[=+\-@\t\r]/u.test(cell));
    expect(dangerous).toEqual([]);
    expect(cells.some((cell) => cell.startsWith("'="))).toBe(true);
    expect(cells.some((cell) => cell.startsWith("'@"))).toBe(true);
  });
});

describe('ATTACK 37 — limits', () => {
  it('stops upload loops per account and per venue, and a stranger cannot spend the venue allowance', async () => {
    const strict = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '1' } });
    try {
      await setVenueFlag(strict, true);
      const venue = await makeVenue(strict);
      const stranger = await person(strict);
      const client = contentApi(strict, venue.owner, venue.venueId);
      for (let i = 0; i < 30; i++)
        expect([404, 429]).toContain(
          (await contentApi(strict, stranger, venue.venueId).dryRun('x')).status,
        );
      const statuses: number[] = [];
      for (let i = 0; i < 9; i++)
        statuses.push((await client.dryRun(`${VENUE_CSV_HEADER}\n`)).status);
      expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(statuses.slice(6).every((s) => s === 429)).toBe(true);
    } finally {
      await strict.dispose();
    }
  });
});

describe('ATTACK 37 — reports and the admin switch', () => {
  it('a reported venue question reaches its owner and the admins; serious reports pull it out of play', async () => {
    const venue = await makeVenue(server);
    const [questionId] = await seedVenueQuestions(server, venue.venueId, 1, { prefix: 'Rapor' });
    for (const session of ['s1', 's2'])
      await submitReport(server.db.db, {
        questionId: questionId!,
        reporterHash: `${session}-${venue.venueId}`,
        reason: 'WRONG_ANSWER',
      });
    const reports = await api(venue.owner, venue).reports();
    expect(reports.body.items).toHaveLength(2);
    expect(reports.body.items[0]).toMatchObject({ questionId, reason: 'WRONG_ANSWER' });
    expect(JSON.stringify(reports.body)).not.toMatch(/reporter|hash/iu);
    // nobody else's owner sees them or acts on them
    expect((await api(b.owner, b).reports()).body.items).toEqual([]);
    expect((await api(b.owner, b).resolve(String(reports.body.items[0].id), 'RETIRE')).status).toBe(
      404,
    );
    // two serious reports pulled the question out of play at once
    const after = await server.db.db
      .selectFrom('questions')
      .select('status')
      .where('id', '=', questionId!)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('REVIEW');
    // the admins see it in the ordinary queue
    const admin = adminApi(server, await adminStaff(server, ['ADMIN']));
    const queue = await admin.get<{ items: { questionId: string }[] }>(
      '/v1/admin/reports?status=OPEN',
    );
    expect(queue.body.items.some((item) => item.questionId === questionId)).toBe(true);
    // the owner retires it for good
    expect(
      (await api(venue.owner, venue).resolve(String(reports.body.items[0].id), 'RETIRE')).status,
    ).toBe(200);
    const done = await server.db.db
      .selectFrom('questions')
      .select('status')
      .where('id', '=', questionId!)
      .executeTakeFirstOrThrow();
    expect(done.status).toBe('RETIRED');
    expect((await api(venue.owner, venue).reports()).body.items).toEqual([]);
  });

  it('only ADMIN retires a venue set from the console; SUPPORT reads; others are refused; it is audited', async () => {
    const venue = await makeVenue(server);
    const imported = await api(venue.owner, venue).import(VENUE_CSV_TEMPLATE);
    const upload = imported.body.uploadId as string;
    const admin = adminApi(server, await adminStaff(server, ['ADMIN']));
    const support = adminApi(server, await adminStaff(server, ['SUPPORT']));
    const editor = adminApi(server, await adminStaff(server, ['EDITOR']));
    const path = `/v1/admin/venues/${venue.venueId}/questions`;
    expect((await support.get(path)).status).toBe(200);
    expect((await editor.get(path)).status).toBe(403);
    expect((await support.post(`${path}/uploads/${upload}/retire`)).status).toBe(403);
    expect((await editor.post(`${path}/uploads/${upload}/retire`)).status).toBe(403);
    expect(
      (await admin.get<{ items: unknown[] }>('/v1/admin/venue-content')).body.items.length,
    ).toBeGreaterThan(0);
    // another venue's id in the path does not reach this upload
    expect(
      (await admin.post(`/v1/admin/venues/${a.venueId}/questions/uploads/${upload}/retire`)).status,
    ).toBe(404);
    expect((await admin.post(`${path}/uploads/${upload}/retire`)).status).toBe(200);
    expect((await rows(venue.venueId)).every((row) => row.status === 'RETIRED')).toBe(true);
    const audit = await server.db.db
      .selectFrom('admin_audit')
      .select('action')
      .where('action', '=', 'venue.content.retire-upload')
      .execute();
    expect(audit.length).toBeGreaterThan(0);
    // the owner can load the same file again afterwards
    expect((await api(venue.owner, venue).import(VENUE_CSV_TEMPLATE)).body.imported).toBe(6);
  });
});
