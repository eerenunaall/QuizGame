/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- responses are inspected loosely */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildZip } from '../helpers/documents';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, toBase64, type VenueFixture } from '../helpers/venue';

/**
 * ATTACK 93 - questions that already exist as text become drafts with no model (ADR-0028 §6). The reader
 * takes pasted text and uploaded documents from an owner's browser: it must stay fast and bounded on
 * hostile input, honour the owner-only gate and the 200-draft list, and never reach a model.
 */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '100' } });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

type Json = Record<string, any>;
const send = (who: { token: string } | null, venue: VenueFixture, path: string, body?: unknown) =>
  call<Json>(server, body === undefined ? 'GET' : 'POST', `/v1/venues/${venue.venueId}${path}`, {
    cookies: false,
    ...(who ? { token: who.token } : {}),
    ...(body !== undefined ? { body } : {}),
  });
const importText = (venue: VenueFixture, text: string, extra: Json = {}) =>
  send(venue.owner, venue, '/authoring/import-text', { text, ...extra });
const drafts = async (venue: VenueFixture) =>
  ((await send(venue.owner, venue, '/authoring/drafts')).body.items as Json[]).length;
const clear = (venueId: string) =>
  server.db.db.deleteFrom('venue_question_drafts').where('venue_id', '=', venueId).execute();

describe('ATTACK 93 - the text reader', () => {
  it('stays fast and bounded on text built to hurt a parser', async () => {
    const hostile = [
      'A) '.repeat(30_000),
      '1. ' + '(a'.repeat(30_000),
      'Cevap: '.repeat(14_000),
      '\n'.repeat(60_000),
      ('1-A,'.repeat(4_000) + '\n').repeat(6),
      '1. Soru?\nA) a\nB) b\nC) c\nD) d\nCevap: A\n'.repeat(2_000).slice(0, 99_000),
    ];
    for (const text of hostile) {
      const started = Date.now();
      const r = await importText(a, text);
      expect(r.status, text.slice(0, 20)).toBe(200);
      expect(Date.now() - started).toBeLessThan(5_000);
      await clear(a.venueId);
    }
  });

  it('refuses an oversized or malformed body before reading it', async () => {
    expect((await importText(a, 'x'.repeat(150_001))).status).toBe(400);
    const huge = await send(a.owner, a, '/authoring/import-text', { text: 'x'.repeat(300_000) });
    expect([400, 413]).toContain(huge.status);
    for (const body of [
      { text: 'x', category: '' },
      { text: 'x', category: 'y'.repeat(81) },
      { text: 'x', __proto__: { admin: true }, extra: 1 },
      { text: 'x', fileName: 'z'.repeat(121) },
      { text: 123 },
      {},
    ])
      expect((await send(a.owner, a, '/authoring/import-text', body)).status).toBe(400);
    expect((await send(a.owner, a, '/authoring/import-file', { data: '' })).status).toBe(400);
    expect(
      (await send(a.owner, a, '/authoring/import-file', { data: 'a'.repeat(30_000_000) })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it('keeps the review list at 200 drafts and says what did not fit', async () => {
    await clear(b.venueId);
    const when = new Date();
    const payload = (n: number) =>
      JSON.stringify({
        category: 'Genel kültür',
        difficulty: 'EASY',
        question: `Dolgu sorusu ${n}`,
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: '',
        sourceQuote: '',
        page: '',
      });
    await server.db.db
      .insertInto('venue_question_drafts')
      .values(
        Array.from({ length: 197 }, (_, n) => ({
          venue_id: b.venueId,
          created_at: new Date(when.getTime() + n),
          expires_at: new Date(when.getTime() + 86_400_000),
          source_file_hash: 'a'.repeat(64),
          source_file_name: 'dolgu',
          origin: 'TEXT' as const,
          payload: payload(n),
        })),
      )
      .execute();
    const topics = [
      ['Galata Kulesi hangi şehirde bulunur?', 'Ankara', 'İzmir', 'İstanbul', 'Bursa', 'C'],
      ['Satranç tahtasında kaç kare vardır?', '36', '49', '64', '81', 'C'],
      ['Monopoly oyununda hangi köşe hapishanedir?', 'Başlangıç', 'Hapis', 'Park', 'Şans', 'B'],
      ['Okey takımında kaç taş bulunur?', '96', '106', '116', '126', 'B'],
      ['Tavla tahtasında her oyuncunun kaç pulu vardır?', 'Onbeş', 'Yirmi', 'On', 'Oniki', 'A'],
    ];
    const text = topics
      .map(
        ([q, o1, o2, o3, o4, c], i) =>
          `${i + 1}. ${q}\nA) ${o1}\nB) ${o2}\nC) ${o3}\nD) ${o4}\nCevap: ${c}`,
      )
      .join('\n\n');
    const r = await importText(b, text);
    expect(r.status).toBe(200);
    expect(await drafts(b)).toBeLessThanOrEqual(200);
    const overCap = (r.body.skipped as Json[]).filter((s) => s.reason === 'over_cap');
    expect(r.body.drafts).toBeLessThanOrEqual(3);
    expect(
      r.body.drafts +
        overCap.length +
        (r.body.skipped as Json[]).filter((s) => s.reason === 'check').length,
    ).toBe(5);
    expect(overCap.length).toBeGreaterThanOrEqual(2);
    await clear(b.venueId);
  });

  it('is for the owner only and never crosses venues', async () => {
    const text = '1. Soru metni burada yazılıdır?\nA) a1\nB) b2\nC) c3\nD) d4\nCevap: B';
    expect((await send(a.staff, a, '/authoring/import-text', { text })).status).toBe(403);
    expect((await send(null, a, '/authoring/import-text', { text })).status).toBe(401);
    expect((await send(b.owner, a, '/authoring/import-text', { text })).status).toBe(404);
    expect(
      (await send(a.staff, a, '/authoring/import-file', { data: toBase64(new Uint8Array([1])) }))
        .status,
    ).toBe(403);
    expect(
      (await send(b.owner, a, '/authoring/import-file', { data: toBase64(new Uint8Array([1])) }))
        .status,
    ).toBe(404);
    expect(await drafts(a)).toBe(0);
    // Imported for B, invisible to A.
    expect((await importText(b, text)).status).toBe(200);
    expect(await drafts(b)).toBe(1);
    expect(await drafts(a)).toBe(0);
  });

  it('turns hostile documents into calm codes, never a crash or a model call', async () => {
    const bomb = buildZip([
      { name: 'word/document.xml', data: new Uint8Array(30 * 1024 * 1024).fill(0x41) },
    ]);
    for (const [fileName, bytes] of [
      ['x.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])],
      ['x.docx', bomb],
      ['x.exe', new Uint8Array([0x4d, 0x5a, 0x90, 0])],
      ['x.txt', new Uint8Array(2000).fill(0)],
    ] as const) {
      const r = await send(a.owner, a, '/authoring/import-file', {
        fileName,
        data: toBase64(bytes),
      });
      expect(r.status, fileName).toBe(422);
      expect(r.body).toMatchObject({ error: { code: 'INVALID_MESSAGE' } });
      expect(JSON.stringify(r.body)).not.toMatch(/stack|at \w+ \(|node_modules/u);
    }
    expect(await drafts(a)).toBe(0);
    // The server runs with no AUTHORING_* key, so a model call is impossible by construction.
    expect((await send(a.owner, a, '/authoring')).body).toMatchObject({ enabled: false });
  });
});
