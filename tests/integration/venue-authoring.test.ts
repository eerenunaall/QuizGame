import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { staff } from '../helpers/admin';
import {
  galataQuestions,
  startAuthoringServer,
  type AuthoringServer,
} from '../helpers/authoring-server';
import { buildDocx, buildPdf, SAMPLE_TEXT, textBytes } from '../helpers/documents';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, toBase64, type VenueFixture } from '../helpers/venue';

/**
 * File -> AI drafts -> owner review -> venue pool (ADR-0028 §6). The remote model is a double that speaks
 * the real wire contract; everything else (extraction in a worker, quotas, the strict parser, the import
 * pipeline) is the real thing.
 */
const KEY = 'test-authoring-key-0123456789';
const MODEL = 'test-model-for-authoring';

let model: AuthoringServer;
let server: TestServer;
let off: TestServer;
let a: VenueFixture;
let b: VenueFixture;

beforeAll(async () => {
  model = await startAuthoringServer(KEY, MODEL, () => ({ questions: galataQuestions() }));
  server = await startServer({
    seed: true,
    env: { AUTHORING_API_KEY: KEY, AUTHORING_MODEL: MODEL, AUTHORING_API_BASE: model.url },
  });
  off = await startServer({ seed: true });
  await setVenueFlag(server, true);
  await setVenueFlag(off, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
beforeEach(() => {
  model.setAnswer(() => ({ questions: galataQuestions() }));
});
afterAll(async () => {
  await server.dispose();
  await off.dispose();
  await model.close();
});

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- responses are inspected loosely */
type Json = Record<string, any>;
const api = (s: TestServer, who: { token: string } | null, venue: VenueFixture) => {
  const send = (method: string, path: string, body?: unknown) =>
    call<Json>(s, method, `/v1/venues/${venue.venueId}${path}`, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  return {
    state: () => send('GET', '/authoring'),
    start: (fileName: string, bytes: Uint8Array, category?: string) =>
      send('POST', '/authoring/runs', {
        fileName,
        data: toBase64(bytes),
        ...(category ? { category } : {}),
      }),
    run: (id: string) => send('GET', `/authoring/runs/${id}`),
    drafts: () => send('GET', '/authoring/drafts'),
    edit: (id: string, body: unknown) => send('POST', `/authoring/drafts/${id}`, body),
    remove: (id: string) => send('POST', `/authoring/drafts/${id}/delete`, {}),
    approve: (body: unknown) => send('POST', '/authoring/drafts/approve', body),
  };
};

async function finished(venue: VenueFixture, runId: string): Promise<Json> {
  for (let i = 0; i < 200; i++) {
    const { body } = await api(server, venue.owner, venue).run(runId);
    if (body.status !== 'RUNNING') return body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the run did not finish');
}
const txt = textBytes.encode(SAMPLE_TEXT);
const ventures = (venueId: string) =>
  server.db.db.selectFrom('questions').selectAll().where('owner_venue_id', '=', venueId).execute();
const reset = async (venueId: string) => {
  await server.db.db.deleteFrom('venue_question_drafts').where('venue_id', '=', venueId).execute();
  await server.db.db.deleteFrom('venue_authoring_runs').where('venue_id', '=', venueId).execute();
  model.setAnswer(() => ({ questions: galataQuestions() }));
};

describe('switched off', () => {
  it('says so, refuses a run and leaves the manual form working', async () => {
    const o = await makeVenue(off);
    const mine = api(off, o.owner, o);
    expect((await mine.state()).body).toMatchObject({ enabled: false });
    const refused = await mine.start('kule.txt', txt);
    expect(refused.status).toBe(404);
    expect(refused.body).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
    const manual = await call<Json>(off, 'POST', `/v1/venues/${o.venueId}/questions/manual`, {
      cookies: false,
      token: o.owner.token,
      body: {
        mode: 'save',
        category: 'Kutu Oyunları',
        question: 'Catan oyununda kaç kaynak türü vardır?',
        options: ['Üç', 'Dört', 'Beş', 'Altı'],
        correctIndex: 2,
        difficulty: 'MEDIUM',
        explanation: 'Kerpiç, odun, koyun, buğday ve cevher olmak üzere beş kaynak vardır.',
      },
    });
    expect(manual.body).toMatchObject({ saved: true });
  });
});

describe('upload -> drafts -> approve -> venue pool', () => {
  let runId = '';
  it('reads the file, calls the model with the contract and stores only drafts', async () => {
    const started = await api(server, a.owner, a).start('kule.txt', txt, 'Galata');
    expect(started.status).toBe(202);
    runId = String(started.body.runId);
    const run = await finished(a, runId);
    expect(run).toMatchObject({ status: 'OK', failure: null });
    expect(run.drafts).toBeGreaterThanOrEqual(4);

    const call1 = model.requests.at(-1)!;
    expect(call1.headers['x-api-key']).toBe(KEY);
    expect(call1.body.model).toBe(MODEL);
    expect(call1.document.map((s) => s.text).join('\n')).toContain('Galata Kulesi');
    expect(call1.body.system).toMatch(/untrusted/i);

    const { body } = await api(server, a.owner, a).drafts();
    const items = body.items as Json[];
    expect(items).toHaveLength(run.drafts);
    expect(items[0]).toMatchObject({
      payload: { category: 'Galata', correctIndex: expect.any(Number) },
    });
    expect(items[0]!.payload.sourceQuote.length).toBeGreaterThan(14);
    expect(items[0]!.payload.page).toMatch(/^bölüm \d+$/u);
    // Nothing is a question yet.
    expect(await ventures(a.venueId)).toHaveLength(0);
    // The document text is not stored: only the hash and the drafts.
    const row = await server.db.db
      .selectFrom('venue_authoring_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(row.source_file_hash).toBe(createHash('sha256').update(txt).digest('hex'));
    expect(JSON.stringify(row)).not.toContain('Cenevizliler');
  });

  it('edits a draft, deletes one, approves one: it becomes an ACTIVE AI_DRAFT venue question', async () => {
    const mine = api(server, a.owner, a);
    const items = ((await mine.drafts()).body.items as Json[]).slice();
    const [first, second, third] = items as [Json, Json, Json];
    const edited = await mine.edit(first.id, {
      category: 'Galata',
      difficulty: 'HARD',
      question: first.payload.question,
      options: first.payload.options,
      correctIndex: first.payload.correctIndex,
      explanation: 'Düzenlenmiş "Biliyor muydun?" açıklaması burada duruyor.',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.draft.payload).toMatchObject({
      difficulty: 'HARD',
      sourceQuote: first.payload.sourceQuote,
    });
    expect((await mine.remove(second.id)).body).toEqual({ ok: true });
    expect((await mine.remove(second.id)).status).toBe(404);

    const approved = await mine.approve({ ids: [first.id] });
    expect(approved.body).toMatchObject({ approved: 1, problems: [] });
    const pool = await ventures(a.venueId);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ status: 'ACTIVE', pool: 'VENUE', author_type: 'AI_DRAFT' });
    const upload = await server.db.db
      .selectFrom('venue_question_uploads')
      .selectAll()
      .where('venue_id', '=', a.venueId)
      .executeTakeFirstOrThrow();
    expect(upload).toMatchObject({ origin: 'AI', rows_imported: 1 });
    expect(upload.source_file_hash).toBe(createHash('sha256').update(txt).digest('hex'));
    const draft = await server.db.db
      .selectFrom('venue_question_drafts')
      .selectAll()
      .where('id', '=', first.id)
      .executeTakeFirstOrThrow();
    expect(draft).toMatchObject({ state: 'APPROVED', question_id: pool[0]!.id });
    // Approved drafts leave the review list; an approved one cannot be approved again.
    expect(((await mine.drafts()).body.items as Json[]).some((d) => d.id === first.id)).toBe(false);
    expect((await mine.approve({ ids: [first.id] })).body).toMatchObject({ approved: 0 });
    expect(third.id).toBeTruthy();
  });

  it('approves all that is left in one upload', async () => {
    const mine = api(server, a.owner, a);
    const left = (await mine.drafts()).body.items as Json[];
    const result = await mine.approve({ all: true });
    expect(result.body).toMatchObject({ approved: left.length, problems: [] });
    expect(await ventures(a.venueId)).toHaveLength(1 + left.length);
    expect(((await mine.drafts()).body.items as Json[]).length).toBe(0);
    const uploads = await server.db.db
      .selectFrom('venue_question_uploads')
      .select(['origin', 'rows_imported'])
      .where('venue_id', '=', a.venueId)
      .execute();
    expect(uploads.every((u) => u.origin === 'AI')).toBe(true);
  });

  it('answers a question twice asked with a duplicate, not a second copy', async () => {
    await server.db.db
      .deleteFrom('venue_question_drafts')
      .where('venue_id', '=', a.venueId)
      .execute();
    const run = await api(server, a.owner, a).start(
      'kule-yine.txt',
      textBytes.encode(`${SAMPLE_TEXT}\n\nEk satır.`),
    );
    const done = await finished(a, String(run.body.runId));
    // Every question the model writes again duplicates a stored one: the dry-run at creation time
    // drops them. Only the one the owner had deleted (so never stored) comes back.
    expect(done).toMatchObject({ status: 'OK', drafts: 1 });
    expect(done.discarded).toBeGreaterThanOrEqual(3);
  });
});

describe('quotas', () => {
  it('stops at the venue quota, shows when it resets and lets an admin raise it', async () => {
    await reset(b.venueId);
    await server.db.db
      .updateTable('venues')
      .set({ authoring_daily_runs: 1 })
      .where('id', '=', b.venueId)
      .execute();
    const mine = api(server, b.owner, b);
    const first = await mine.start('bir.txt', txt);
    expect(first.status).toBe(202);
    await finished(b, String(first.body.runId));
    expect((await mine.state()).body.quota).toMatchObject({ limit: 1, used: 1 });
    const second = await mine.start('iki.txt', textBytes.encode(`${SAMPLE_TEXT} Başka.`));
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({
      error: { code: 'RATE_LIMITED', params: { reason: 'quota', limit: 1 } },
    });

    const admin = await staff(server, ['ADMIN']);
    const raised = await call<Json>(server, 'POST', `/v1/admin/venues/${b.venueId}/authoring`, {
      cookies: false,
      token: admin.token,
      body: { dailyRuns: 3 },
    });
    expect(raised.body).toEqual({ dailyRuns: 3 });
    const third = await mine.start('uc.txt', textBytes.encode(`${SAMPLE_TEXT} Üçüncü.`));
    expect(third.status).toBe(202);
    await finished(b, String(third.body.runId));
    const audit = await server.db.db
      .selectFrom('admin_audit')
      .select('action')
      .where('action', '=', 'venue.authoring_quota')
      .execute();
    expect(audit.length).toBeGreaterThan(0);
  });

  it('does not count a file that cannot be read, nor a model outage', async () => {
    await reset(b.venueId);
    await server.db.db
      .updateTable('venues')
      .set({ authoring_daily_runs: 2 })
      .where('id', '=', b.venueId)
      .execute();
    const mine = api(server, b.owner, b);
    const calls = model.requests.length;
    const bad = await mine.start('gizli.pdf', buildPdf({ pages: [SAMPLE_TEXT], encrypt: true }));
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ error: { params: { reason: 'pdf_encrypted' } } });
    expect(model.requests.length).toBe(calls);
    expect((await mine.state()).body.quota.used).toBe(0);

    model.setAnswer(() => ({ status: 500 }));
    const down = await mine.start('kesinti.txt', txt);
    const run = await finished(b, String(down.body.runId));
    expect(run).toMatchObject({ status: 'FAILED', failure: 'unavailable' });
    expect((await mine.state()).body.quota.used).toBe(0);
  });

  it('runs one document at a time per venue', async () => {
    await reset(b.venueId);
    model.setAnswer(() => ({ questions: galataQuestions(), delayMs: 400 }));
    const mine = api(server, b.owner, b);
    const first = await mine.start('yavas.txt', txt);
    expect(first.status).toBe(202);
    const second = await mine.start('hizli.txt', textBytes.encode(`${SAMPLE_TEXT} Ek.`));
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { params: { reason: 'running' } } });
    await finished(b, String(first.body.runId));
    // The same file again while its drafts wait for review costs nothing.
    const same = await mine.start('yavas.txt', txt);
    expect(same.body).toMatchObject({ error: { params: { reason: 'same_file' } } });
  });
});

describe('model failures', () => {
  it('maps a rejected key and an outage to codes, never echoing anything from the service', async () => {
    const c = await makeVenue(server);
    const mine = api(server, c.owner, c);
    model.setAnswer(() => ({ status: 401 }));
    const run = await finished(c, String((await mine.start('a.txt', txt)).body.runId));
    expect(run).toMatchObject({ status: 'FAILED', failure: 'rejected_key' });
    expect(JSON.stringify(run)).not.toContain(KEY);
    expect(JSON.stringify(run)).not.toContain(MODEL);
  });
});

describe('who may do what', () => {
  it('is for the owner of the venue only, and drafts never cross venues', async () => {
    await reset(a.venueId);
    const run = await api(server, a.owner, a).start(
      'rol.txt',
      textBytes.encode(`${SAMPLE_TEXT} Rol testi.`),
    );
    await finished(a, String(run.body.runId));
    const [draft] = (await api(server, a.owner, a).drafts()).body.items as Json[];
    expect(draft).toBeTruthy();

    expect((await api(server, a.staff, a).drafts()).status).toBe(403);
    expect((await api(server, a.staff, a).start('x.txt', txt)).status).toBe(403);
    expect((await api(server, a.staff, a).approve({ all: true })).status).toBe(403);
    expect((await api(server, null, a).state()).status).toBe(401);
    // Another venue's owner: not found, not forbidden, and the draft id leaks nothing.
    expect((await api(server, b.owner, a).drafts()).status).toBe(404);
    expect(
      (
        await api(server, b.owner, b).edit(draft!.id, {
          category: 'x',
          difficulty: 'EASY',
          question: draft!.payload.question,
          options: draft!.payload.options,
          correctIndex: 0,
          explanation: draft!.payload.explanation,
        })
      ).status,
    ).toBe(404);
    expect((await api(server, b.owner, b).remove(draft!.id)).status).toBe(404);
    const stolen = await api(server, b.owner, b).approve({ ids: [draft!.id] });
    expect(stolen.body).toMatchObject({ approved: 0 });
    expect(await ventures(b.venueId)).toHaveLength(0);
    expect((await api(server, a.owner, a).run(String(run.body.runId))).status).toBe(200);
    expect((await api(server, b.owner, b).run(String(run.body.runId))).status).toBe(404);
    // Strict bodies.
    expect((await api(server, a.owner, a).approve({ all: true, extra: 1 })).status).toBe(400);
    expect((await api(server, a.owner, a).approve({ ids: [] })).status).toBe(400);
    const noCategory = await call<Json>(server, 'POST', `/v1/venues/${a.venueId}/authoring/runs`, {
      cookies: false,
      token: a.owner.token,
      body: { fileName: 'x.txt', data: toBase64(txt), category: '' },
    });
    expect(noCategory.status).toBe(400);
  });
});

describe('expiry', () => {
  it('deletes drafts after their seven days and fails a run whose process is gone', async () => {
    await reset(a.venueId);
    const run = await api(server, a.owner, a).start(
      'eski.txt',
      textBytes.encode(`${SAMPLE_TEXT} Eski.`),
    );
    await finished(a, String(run.body.runId));
    const live = await api(server, a.owner, a).drafts();
    expect((live.body.items as Json[]).length).toBeGreaterThan(0);
    // 7 days are written into the row at creation.
    const row = await server.db.db
      .selectFrom('venue_question_drafts')
      .select(['created_at', 'expires_at'])
      .where('venue_id', '=', a.venueId)
      .limit(1)
      .executeTakeFirstOrThrow();
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(7 * 24 * 3600 * 1000);

    await server.db.db
      .updateTable('venue_question_drafts')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('venue_id', '=', a.venueId)
      .execute();
    // Expired drafts are invisible at once, and cannot be approved even before the job runs.
    expect(((await api(server, a.owner, a).drafts()).body.items as Json[]).length).toBe(0);
    expect((await api(server, a.owner, a).approve({ all: true })).body).toMatchObject({
      approved: 0,
    });
    await server.built.maintenance.runOnce();
    const left = await server.db.db
      .selectFrom('venue_question_drafts')
      .select('id')
      .where('venue_id', '=', a.venueId)
      .execute();
    expect(left).toHaveLength(0);

    const stuck = await server.db.db
      .insertInto('venue_authoring_runs')
      .values({
        venue_id: a.venueId,
        at: new Date(Date.now() - 3600_000),
        source_file_hash: '0'.repeat(64),
        source_file_name: 'asili.txt',
        input_chars: 1,
        status: 'RUNNING',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await server.built.maintenance.runOnce();
    expect((await api(server, a.owner, a).run(stuck.id)).body).toMatchObject({
      status: 'FAILED',
      failure: 'interrupted',
    });
  });
});

describe('documents', () => {
  it('reads a DOCX and a PDF', async () => {
    const c = await makeVenue(server);
    await server.db.db
      .updateTable('venues')
      .set({ authoring_daily_runs: 5 })
      .where('id', '=', c.venueId)
      .execute();
    const mine = api(server, c.owner, c);
    const docx = await mine.start('kule.docx', buildDocx(SAMPLE_TEXT.split('\n\n')));
    expect(docx.status).toBe(202);
    expect(await finished(c, String(docx.body.runId))).toMatchObject({ status: 'OK' });
    await server.db.db
      .deleteFrom('venue_question_drafts')
      .where('venue_id', '=', c.venueId)
      .execute();
    const pdfText = galataQuestions().length > 0 ? 'Galata Tower facts. '.repeat(30) : '';
    const pdf = await mine.start('kule.pdf', buildPdf({ pages: [pdfText.slice(0, 500)] }));
    expect(pdf.status).toBe(202);
    const run = await finished(c, String(pdf.body.runId));
    // The double's questions quote the Turkish sample, which this PDF does not contain: all dropped.
    expect(run).toMatchObject({ status: 'EMPTY', drafts: 0 });
  });

  it('turns hostile files into Turkish-ready error codes without calling the model', async () => {
    const c = await makeVenue(server);
    const mine = api(server, c.owner, c);
    const calls = model.requests.length;
    const cases: [string, Uint8Array, string][] = [
      ['x.txt', textBytes.encode('çok kısa'), 'no_text'],
      ['x.exe', textBytes.encode(SAMPLE_TEXT), 'unsupported'],
      ['x.pdf', textBytes.encode('%PDF-1.4 bozuk'), 'corrupt'],
      ['x.docx', new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6]), 'corrupt'],
    ];
    for (const [name, bytes, reason] of cases) {
      const res = await mine.start(name, bytes);
      expect(res.status, name).toBe(422);
      expect(res.body, name).toMatchObject({ error: { params: { reason } } });
    }
    expect(model.requests.length).toBe(calls);
  });
});

describe('circuit breaker', () => {
  it('opens the circuit after repeated outages and stops calling the service', async () => {
    const d = await makeVenue(server);
    const mine = api(server, d.owner, d);
    model.setAnswer(() => ({ status: 529 }));
    for (let i = 0; i < 3; i++) {
      const run = await finished(
        d,
        String((await mine.start(`o${i}.txt`, textBytes.encode(`${SAMPLE_TEXT} ${i}`))).body.runId),
      );
      expect(run.failure).toBe('unavailable');
    }
    const before = model.requests.length;
    const blocked = await finished(
      d,
      String((await mine.start('x.txt', textBytes.encode(`${SAMPLE_TEXT} x`))).body.runId),
    );
    expect(blocked).toMatchObject({ status: 'FAILED', failure: 'unavailable' });
    expect(model.requests.length).toBe(before);
  });
});
