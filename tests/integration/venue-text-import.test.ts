/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- responses are inspected loosely */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocx } from '../helpers/documents';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, toBase64, type VenueFixture } from '../helpers/venue';

/**
 * Questions that already exist as text -> drafts -> owner review -> venue pool (ADR-0028 §6), with NO
 * model and NO AUTHORING_* key on the server: the owner decided the AI path stays off. Everything else
 * (extraction worker, review gate, import pipeline) is the real thing.
 */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: true });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

type Json = Record<string, any>;
const api = (who: { token: string } | null, venue: VenueFixture) => {
  const send = (method: string, path: string, body?: unknown) =>
    call<Json>(server, method, `/v1/venues/${venue.venueId}${path}`, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  return {
    state: () => send('GET', '/authoring'),
    importText: (body: unknown) => send('POST', '/authoring/import-text', body),
    importFile: (body: unknown) => send('POST', '/authoring/import-file', body),
    drafts: () => send('GET', '/authoring/drafts'),
    approve: (body: unknown) => send('POST', '/authoring/drafts/approve', body),
  };
};
const reset = async (venueId: string) => {
  await server.db.db.deleteFrom('venue_question_drafts').where('venue_id', '=', venueId).execute();
};
const pool = (venueId: string) =>
  server.db.db.selectFrom('questions').selectAll().where('owner_venue_id', '=', venueId).execute();

const GOOD = `1. Galata Kulesi hangi şehirde bulunur?
A) Ankara
B) İzmir
C) İstanbul
D) Bursa
Cevap: C
Açıklama: Galata Kulesi İstanbul'da, Beyoğlu ilçesindedir.

2. Catan oyununda kaç tür kaynak vardır?
A) Üç
B) Dört
C) Beş
D) Altı
Cevap: C

3. Üç şıklı bir soru burada sorulur?
A) Bir
B) İki
C) Üç
Cevap: A
`;

const SECOND = `1. Monopoly oyununda bir turda en fazla kaç zar atılır?
A) Bir
B) İki
C) Üç
D) Dört
Cevap: B

2. Satranç tahtasında toplam kaç kare bulunur?
A) 36
B) 49
C) 64
D) 81
Cevap: 64
`;

describe('text -> drafts without any key', () => {
  it('works with the model switched off, lists what it could not read, and approves into the pool', async () => {
    await reset(a.venueId);
    const mine = api(a.owner, a);
    expect((await mine.state()).body).toMatchObject({ enabled: false });
    const made = await mine.importText({
      fileName: 'Benim sorularım',
      text: GOOD,
      category: 'Genel kültür',
      difficulty: 'EASY',
    });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ drafts: 2, keyUsed: false });
    expect(made.body.skipped).toEqual([
      expect.objectContaining({ reason: 'options_count', number: 3 }),
    ]);

    const listed = (await mine.drafts()).body.items as Json[];
    expect(listed).toHaveLength(2);
    expect(listed[0]!.payload).toMatchObject({
      category: 'Genel kültür',
      difficulty: 'EASY',
      correctIndex: 2,
      sourceQuote: '',
    });
    // Nothing is a question before the owner approves.
    expect(await pool(a.venueId)).toHaveLength(0);

    const approved = await mine.approve({ all: true });
    expect(approved.body).toMatchObject({ approved: 2, problems: [] });
    const questions = await pool(a.venueId);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      status: 'ACTIVE',
      pool: 'VENUE',
      author_type: 'AI_ASSISTED',
    });
    const upload = await server.db.db
      .selectFrom('venue_question_uploads')
      .selectAll()
      .where('venue_id', '=', a.venueId)
      .executeTakeFirstOrThrow();
    // Not the AI label: these are the owner's own questions.
    expect(upload).toMatchObject({ origin: 'FILE', rows_imported: 2 });
    expect(upload.file_name).toBe('Belge: Benim sorularım');
  });

  it('the same text twice is refused, and a changed copy of approved questions is caught as duplicates', async () => {
    await reset(a.venueId);
    const mine = api(a.owner, a);
    const text = `${SECOND}\n`;
    expect((await mine.importText({ text })).body).toMatchObject({ drafts: 2 });
    const again = await mine.importText({ text });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      error: { code: 'INVALID_STATE', params: { reason: 'same_file' } },
    });
    expect((await mine.approve({ all: true })).body).toMatchObject({ approved: 2, problems: [] });
    const copy = await mine.importText({ text: `${SECOND}\n\n` });
    expect(copy.status).toBe(200);
    expect(copy.body.drafts).toBe(0);
    expect(copy.body.skipped.filter((s: Json) => s.reason === 'check')).toHaveLength(2);
    expect(copy.body.skipped.find((s: Json) => s.reason === 'check').codes.length).toBeGreaterThan(
      0,
    );
  });

  it('reads an answer key at the end', async () => {
    await reset(b.venueId);
    const text = `1. Dünyanın en büyük okyanusu hangisidir?\nA) Hint\nB) Atlas\nC) Arktik\nD) Pasifik\n2. Mona Lisa tablosunu kim yapmıştır?\nA) Picasso\nB) Da Vinci\nC) Van Gogh\nD) Monet\n\nCevap Anahtarı: 1-D 2-B`;
    const r = await api(b.owner, b).importText({ text });
    expect(r.body).toMatchObject({ drafts: 2, keyUsed: true });
    expect(
      ((await api(b.owner, b).drafts()).body.items as Json[]).map((d) => d.payload.correctIndex),
    ).toEqual([3, 1]);
  });

  it('reads a DOCX with the same parser', async () => {
    await reset(a.venueId);
    const docx = buildDocx([
      'Soru 1: Okey oyununda kaç taş bulunur?',
      'A) 96',
      'B) 106',
      'C) 116',
      'D) 126',
      'Cevap: B',
      'Soru 2: Tavla tahtasında her oyuncunun kaç pulu vardır?',
      'A) Onbeş',
      'B) Yirmi',
      'C) On',
      'D) Oniki',
      'Cevap: Onbeş',
      ...Array.from(
        { length: 12 },
        (_, i) => `Bu satır belgenin yeterince uzun olması için eklenen dolgudur ${i}.`,
      ),
    ]);
    const r = await api(a.owner, a).importFile({
      fileName: 'sorular.docx',
      data: toBase64(docx),
      category: 'Oyunlar',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body, JSON.stringify(r.body.skipped)).toMatchObject({ drafts: 2 });
    expect(
      ((await api(a.owner, a).drafts()).body.items as Json[]).map((d) => d.payload.correctIndex),
    ).toEqual([1, 0]);
  });

  it('sends spreadsheets and JSON lines to the question upload box, and refuses junk', async () => {
    const mine = api(a.owner, a);
    for (const text of [
      'category,difficulty,question,optionA,optionB,optionC,optionD,correct\nx,EASY,q,a,b,c,d,A',
      '{"question":"x"}',
    ]) {
      const r = await mine.importText({ text });
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ error: { params: { reason: 'table_format' } } });
    }
    expect((await mine.importText({ text: 'x', extra: 1 })).status).toBe(400);
    expect((await mine.importText({ text: '' })).status).toBe(400);
    expect((await mine.importText({ text: 'x', difficulty: 'IMPOSSIBLE' })).status).toBe(400);
    const none = await mine.importText({ text: 'Sadece bir başlık var, soru yok.' });
    expect(none.body).toMatchObject({ drafts: 0, skipped: [] });
    expect((await mine.importFile({ data: '***not base64***' })).status).toBe(400);
    const bin = await mine.importFile({
      fileName: 'x.pdf',
      data: toBase64(new Uint8Array([1, 2, 3, 4])),
    });
    expect(bin.status).toBe(422);
  });

  it('is for the owner of the venue only', async () => {
    await reset(a.venueId);
    const text = GOOD + '\n(sahiplik denemesi)';
    expect((await api(a.staff, a).importText({ text })).status).toBe(403);
    expect((await api(null, a).importText({ text })).status).toBe(401);
    expect((await api(b.owner, a).importText({ text })).status).toBe(404);
    expect((await api(a.staff, a).importFile({ data: toBase64(new Uint8Array([1])) })).status).toBe(
      403,
    );
    expect((await api(a.owner, a).drafts()).body.items as Json[]).toHaveLength(0);
  });
});
