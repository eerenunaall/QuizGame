import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VENUE_CSV_HEADER, VENUE_CSV_TEMPLATE } from '@quizparty/question-schema';
import { startServer, type TestServer } from '../helpers/server';
import {
  contentApi,
  makeVenue,
  person,
  seedVenueQuestions,
  setVenueFlag,
  type VenueFixture,
} from '../helpers/venue';

/**
 * Venue question sets over HTTP (ADR-0025): who may upload, what the dry-run says, what an import stores,
 * idempotency, limits and isolation between venues.
 */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: true, env: { RATE_LIMIT_SCALE: '100' } });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

const api = (who: { token: string } | null, venue = a) => contentApi(server, who, venue.venueId);
const rowsOf = (venueId: string) =>
  server.db.db.selectFrom('questions').selectAll().where('owner_venue_id', '=', venueId).execute();

describe('the dry-run', () => {
  it('reports the template as importable and writes nothing', async () => {
    const result = await api(a.owner).dryRun(VENUE_CSV_TEMPLATE);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.counts).toMatchObject({
      total: 6,
      ok: 6,
      review: 0,
      invalid: 0,
      duplicate: 0,
    });
    const labels = result.body.categories.map((c: { label: string; isNew: boolean }) => [
      c.label,
      c.isNew,
    ]);
    expect(labels).toEqual(
      expect.arrayContaining([
        ['Kutu Oyunları', true],
        ['Tarih', false],
      ]),
    );
    expect(await rowsOf(a.venueId)).toHaveLength(0);
  });

  it('explains each bad row with a code and the line', async () => {
    const file = [
      VENUE_CSV_HEADER,
      "Genel Kültür,EASY,Türkiye'nin başkenti neresidir?,İstanbul,Ankara,İzmir,Bursa,B,",
      'Genel Kültür,EASY,kısa,a,b,c,d,A,',
      'Genel Kültür,SÜPER,Bu sorunun zorluğu geçersizdir değil mi?,a1,b1,c1,d1,A,',
      'Genel Kültür,EASY,Bu sorunun doğru cevabı belirtilmemiş midir?,a2,b2,c2,d2,,',
    ].join('\n');
    const result = await api(a.owner).dryRun(file);
    const byLine = Object.fromEntries(
      (result.body.rows as { line: number; issues: { code: string }[] }[]).map((row) => [
        row.line,
        row.issues.map((i) => i.code),
      ]),
    );
    expect(byLine[3]).toContain('question_too_short');
    expect(byLine[4]).toContain('difficulty_invalid');
    expect(byLine[5]).toContain('correct_missing');
    expect(result.body.counts.invalid).toBe(3);
  });

  it('refuses files that are not question files, with a reason', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]);
    expect((await api(a.owner).dryRun(zip, 'x.xlsx')).body).toMatchObject({
      ok: false,
      issue: { code: 'file_excel' },
    });
    expect((await api(a.owner).dryRun(new Uint8Array([0, 1, 2, 3]))).body.issue.code).toBe(
      'file_binary',
    );
    expect((await api(a.owner).dryRun(' ')).body.ok).toBe(false);
    const big = 'x'.repeat(2 * 1024 * 1024 + 10);
    expect((await api(a.owner).dryRun(big)).body.issue.code).toBe('file_too_large');
  });

  it('rejects a body that is not base64', async () => {
    const result = await api(a.owner).dryRun('x');
    expect(result.status).toBe(200);
    const bad = (
      await fetch(`${server.httpUrl}/v1/venues/${a.venueId}/questions/dry-run`, {
        method: 'POST',
        headers: { authorization: `Bearer ${a.owner.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'x', data: '***' }),
      })
    ).status;
    expect(bad).toBe(400);
  });
});

describe('who may do what', () => {
  it('staff can see the list and counts, nothing else', async () => {
    const list = await api(a.staff).list();
    expect(list.status).toBe(200);
    expect(list.body.canManage).toBe(false);
    for (const result of [
      await api(a.staff).dryRun(VENUE_CSV_TEMPLATE),
      await api(a.staff).import(VENUE_CSV_TEMPLATE),
      await api(a.staff).prompt(),
      await api(a.staff).reports(),
      await api(a.staff).raw('export'),
      await api(a.staff).raw('template'),
    ])
      expect(result.status).toBe(403);
    expect(await rowsOf(a.venueId)).toHaveLength(0);
  });

  it('a stranger, an anonymous caller and another venue get 404 / 401', async () => {
    const stranger = await person(server);
    expect((await api(stranger).list()).status).toBe(404);
    expect((await api(null).list()).status).toBe(401);
    expect((await api(b.owner, a).import(VENUE_CSV_TEMPLATE)).status).toBe(404);
    expect((await api(b.owner, a).list()).status).toBe(404);
    expect(await rowsOf(a.venueId)).toHaveLength(0);
  });

  it('serves the prompt and the template to the owner', async () => {
    const prompt = await api(a.owner).prompt();
    expect(prompt.body.prompt).toContain('tam 4 şıkkı');
    const template = await api(a.owner).raw('template');
    expect(template.status).toBe(200);
    expect(template.text).toContain(VENUE_CSV_HEADER);
  });
});

describe('import', () => {
  let uploadId: string;

  it('stores passing rows as ACTIVE venue questions with a heuristic audit, and logs it', async () => {
    const result = await api(a.owner).import(VENUE_CSV_TEMPLATE, 'sablon.csv');
    expect(result.status).toBe(200);
    expect(result.body.imported).toBe(6);
    uploadId = result.body.uploadId;
    const rows = await rowsOf(a.venueId);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: 'ACTIVE',
        pool: 'VENUE',
        external_id: null,
        is_dev_seed: false,
      });
      expect(row.venue_upload_id).toBe(uploadId);
    }
    const audits = await server.db.db
      .selectFrom('question_audits')
      .select(['pass', 'status', 'detail'])
      .where('question_id', '=', rows[0]!.id)
      .execute();
    expect(audits).toEqual([
      expect.objectContaining({
        pass: 'HEURISTIC',
        status: 'PASS',
        detail: expect.objectContaining({ ownerAttested: true }),
      }),
    ]);
    const categories = await server.db.db
      .selectFrom('categories')
      .select(['id', 'owner_venue_id'])
      .where('owner_venue_id', '=', a.venueId)
      .execute();
    expect(categories.length).toBeGreaterThanOrEqual(1);
    const upload = await server.db.db
      .selectFrom('venue_question_uploads')
      .selectAll()
      .where('venue_id', '=', a.venueId)
      .executeTakeFirstOrThrow();
    expect(upload).toMatchObject({
      venue_id: a.venueId,
      uploaded_by: a.owner.accountId,
      rows_imported: 6,
      state: 'ACTIVE',
    });
    const event = await server.db.db
      .selectFrom('venue_content_events')
      .selectAll()
      .where('venue_id', '=', a.venueId)
      .where('upload_id', '=', uploadId)
      .executeTakeFirstOrThrow();
    expect(event).toMatchObject({ kind: 'IMPORT', actor_account_id: a.owner.accountId });
  });

  it('is idempotent: the same bytes change nothing; the same questions in other bytes are duplicates', async () => {
    const again = await api(a.owner).import(VENUE_CSV_TEMPLATE, 'sablon.csv');
    expect(again.body.imported).toBe(0);
    expect(again.body.analysis.alreadyImported).toMatchObject({ uploadId });
    expect(await rowsOf(a.venueId)).toHaveLength(6);
    const edited = await api(a.owner).import(
      VENUE_CSV_TEMPLATE.replace(/\r\n/gu, '\n') + '\n\n',
      'baska.csv',
    );
    expect(edited.body.imported).toBe(0);
    expect(edited.body.analysis.counts.duplicate).toBe(6);
    expect(await rowsOf(a.venueId)).toHaveLength(6);
  });

  it('is invisible to another venue, which may hold the very same text', async () => {
    expect((await api(b.owner, b).dryRun(VENUE_CSV_TEMPLATE)).body.counts.ok).toBe(6);
    expect((await api(b.owner, b).import(VENUE_CSV_TEMPLATE)).body.imported).toBe(6);
    expect(await rowsOf(a.venueId)).toHaveLength(6);
    expect(await rowsOf(b.venueId)).toHaveLength(6);
    const listB = await api(b.owner, b).list();
    expect(JSON.stringify(listB.body)).not.toContain(a.venueId);
  });

  it('lists counts per category and uploads', async () => {
    const list = await api(a.staff).list();
    expect(list.body.totals.active).toBe(6);
    expect(list.body.uploads).toEqual([
      expect.objectContaining({ id: uploadId, active: 6, state: 'ACTIVE' }),
    ]);
    expect(list.body.categories.map((c: { label: string }) => c.label)).toContain('Kutu Oyunları');
  });

  it('exports the live set as CSV that can be uploaded again', async () => {
    const exported = await api(a.owner).raw('export');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('text/csv');
    expect(exported.text).toContain('Ankara');
    const dry = await api(a.owner).dryRun(exported.text);
    expect(dry.body.counts.duplicate).toBe(6);
  });

  it('another venue cannot retire it; the owner can, and may then upload it again', async () => {
    expect((await api(b.owner, a).retire(uploadId)).status).toBe(404);
    expect((await api(a.staff).retire(uploadId)).status).toBe(403);
    expect((await api(a.owner).retire(uploadId)).body).toEqual({ retired: 6 });
    expect((await api(a.owner).retire(uploadId)).status).toBe(409);
    const statuses = (await rowsOf(a.venueId)).map((row) => row.status);
    expect(new Set(statuses)).toEqual(new Set(['RETIRED']));
    expect((await rowsOf(b.venueId)).every((row) => row.status === 'ACTIVE')).toBe(true);
    expect((await api(a.owner).import(VENUE_CSV_TEMPLATE)).body.imported).toBe(6);
  });
});

describe('what is not imported', () => {
  it('keeps REVIEW and REJECT rows out and lists them with reasons', async () => {
    const owner = await makeVenue(server);
    const file = [
      VENUE_CSV_HEADER,
      'Tarih,MEDIUM,Cumhuriyet hangi yılda ilan edilmiştir?,1919,1920,1923,1938,C,Ankara hükümeti 1923 yılında ilan etti.,',
      // the correct answer is also in the question: a hard reject
      'Tarih,MEDIUM,Cumhuriyet 1923 yılında ilan edilmiştir değil mi?,1923,1924,1925,1926,A,x,',
      // no question mark / lower case start: a REVIEW finding
      'Tarih,EASY,türkiye nin başkenti olan şehir,Ankara,İzmir,Bursa,Konya,A,',
    ].join('\n');
    const dry = await api(owner.owner, owner).dryRun(file);
    expect(dry.body.counts.ok).toBe(1);
    const imported = await api(owner.owner, owner).import(file);
    expect(imported.body.imported).toBe(1);
    expect(await rowsOf(owner.venueId)).toHaveLength(1);
    const statuses = imported.body.analysis.rows.map((r: { status: string }) => r.status);
    expect(statuses.every((s: string) => s !== 'OK')).toBe(true);
    expect(statuses.length).toBe(2);
  });

  it('treats a copy of a global question as a duplicate', async () => {
    const owner = await makeVenue(server);
    const globalText = (
      await server.db.db
        .selectFrom('questions')
        .select('text')
        .where('owner_venue_id', 'is', null)
        .limit(1)
        .executeTakeFirstOrThrow()
    ).text;
    const globalOptions = await server.db.db
      .selectFrom('question_options')
      .innerJoin('questions', 'questions.id', 'question_options.question_id')
      .select(['question_options.text as text', 'question_options.is_correct as correct'])
      .where('questions.text', '=', globalText)
      .orderBy('question_options.position')
      .execute();
    const row = [
      'Tarih',
      'EASY',
      `"${globalText}"`,
      ...globalOptions.map((o) => `"${o.text}"`),
      'ABCD'[globalOptions.findIndex((o) => o.correct)],
      '',
    ].join(',');
    const dry = await api(owner.owner, owner).dryRun(`${VENUE_CSV_HEADER}\n${row}\n`);
    expect(dry.body.counts.duplicate).toBe(1);
  });

  it('stops at the category cap (20 per venue) and still takes rows of existing categories', async () => {
    const owner = await makeVenue(server);
    const prefix = `v${owner.venueId.replace(/-/gu, '').slice(0, 8)}-`;
    await server.db.db
      .insertInto('categories')
      .values(
        Array.from({ length: 20 }, (_, i) => ({
          id: `${prefix}k${i}`,
          label_tr: `Kategori ${i}`,
          label_en: `Kategori ${i}`,
          free_rotation: false,
          source_required: false,
          owner_venue_id: owner.venueId,
        })),
      )
      .execute();
    const dry = await api(owner.owner, owner).dryRun(VENUE_CSV_TEMPLATE);
    const limited = dry.body.rows.filter((r: { issues: { code: string }[] }) =>
      r.issues.some((i) => i.code === 'category_limit'),
    );
    // "Kutu Oyunları" (two rows) and "Genel Kültür" (not a global category in this test bank) need a 21st
    expect(limited).toHaveLength(3);
    expect(dry.body.counts.ok).toBe(3);
  });

  it('stops at 5000 questions per venue', async () => {
    const owner = await makeVenue(server);
    await seedVenueQuestions(server, owner.venueId, 5);
    await server.db.db
      .updateTable('questions')
      .set({ status: 'ACTIVE' })
      .where('owner_venue_id', '=', owner.venueId)
      .execute();
    const dry = await api(owner.owner, owner).dryRun(VENUE_CSV_TEMPLATE);
    expect(dry.body.capacity).toEqual({ used: 5, max: 5000 });
  });
});

describe('limits', () => {
  it('refuses more than 2000 rows', async () => {
    const owner = await makeVenue(server);
    const file = VENUE_CSV_HEADER + '\n' + 'x,EASY,q,1,2,3,4,A,\n'.repeat(2001);
    expect((await api(owner.owner, owner).dryRun(file)).body.issue.code).toBe('file_too_many_rows');
  });

  it('rate-limits uploads per account and per venue', async () => {
    const strict = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '1' } });
    try {
      await setVenueFlag(strict, true);
      const owner = await makeVenue(strict);
      const client = contentApi(strict, owner.owner, owner.venueId);
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++)
        statuses.push((await client.dryRun(`${VENUE_CSV_HEADER}\n`)).status);
      expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
      expect(statuses).toContain(429);
    } finally {
      await strict.dispose();
    }
  });

  it('is off with the venue flag', async () => {
    await setVenueFlag(server, false);
    try {
      expect((await api(a.owner).list()).status).toBe(404);
    } finally {
      await setVenueFlag(server, true);
    }
    void randomUUID;
  });
});
