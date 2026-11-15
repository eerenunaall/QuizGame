/* eslint-disable @typescript-eslint/no-explicit-any -- responses are inspected loosely */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call } from '../helpers/payments';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, type VenueFixture } from '../helpers/venue';

/**
 * "Yanlış seçenekleri otomatik doldur" (owner request 2026-11-15): the right answer in, look-alike wrong
 * options out, no model. Candidates are the global bank's and the caller's own café's right answers only.
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

type Json = Record<string, any>;
const options = (who: { token: string } | null, venue: VenueFixture, body: unknown) =>
  call<Json>(server, 'POST', `/v1/venues/${venue.venueId}/authoring/options`, {
    cookies: false,
    ...(who ? { token: who.token } : {}),
    body,
  });

describe('automatic wrong options', () => {
  it('gives four options with the right answer at a random place', async () => {
    const places = new Set<number>();
    for (let i = 0; i < 24; i++) {
      const r = await options(a.owner, a, { correct: 'Bryan Cranston', category: 'Diziler' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const got = r.body.options as string[];
      expect(got).toHaveLength(4 - (r.body.missing as number));
      expect(got[r.body.correctIndex as number]).toBe('Bryan Cranston');
      expect(new Set(got).size).toBe(got.length);
      places.add(r.body.correctIndex as number);
    }
    expect(places.size).toBeGreaterThan(1);
  });

  it("makes near numbers for a year and uses the owner's own list first", async () => {
    const year = await options(a.owner, a, { correct: '1923' });
    expect(year.body).toMatchObject({ kind: 'NUMBER', missing: 0 });
    for (const o of year.body.options as string[])
      expect(Math.abs(Number(o) - 1923)).toBeLessThanOrEqual(30);
    const own = await options(a.owner, a, {
      correct: 'Bryan Cranston',
      own: ['Hugh Laurie', 'Steve Carell', 'Jon Hamm'],
    });
    expect(own.body.fromOwn).toBe(3);
    expect([...own.body.options].sort()).toEqual(
      ['Bryan Cranston', 'Hugh Laurie', 'Jon Hamm', 'Steve Carell'].sort(),
    );
  });

  it("never offers another café's private answer", async () => {
    const saved = await call<Json>(server, 'POST', `/v1/venues/${b.venueId}/questions/manual`, {
      cookies: false,
      token: b.owner.token,
      body: {
        mode: 'save',
        category: 'Kutu Oyunları',
        question: 'Bu özel soruda Jesse Pinkman hangi karakterle çalışır acaba?',
        options: ['Walter White', 'Saul Goodman', 'Hank Schrader', 'Mike Ehrmantraut'],
        correctIndex: 0,
        difficulty: 'MEDIUM',
        explanation: 'Özel kafe sorusu: Walter White ile çalışır, bu açıklama yeterince uzundur.',
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.saved, JSON.stringify(saved.body)).toBe(true);
    for (let i = 0; i < 40; i++) {
      const r = await options(a.owner, a, { correct: 'Jesse Pinkman', category: 'Kutu Oyunları' });
      expect(r.body.options as string[]).not.toContain('Walter White');
    }
    // The author's own café may be offered its own answer.
    let seen = false;
    for (let i = 0; i < 60 && !seen; i++) {
      const r = await options(b.owner, b, { correct: 'Jesse Pinkman', category: 'Kutu Oyunları' });
      seen = (r.body.options as string[]).includes('Walter White');
    }
    expect(seen).toBe(true);
  });

  it('is for the owner only and takes a strict body', async () => {
    const body = { correct: 'Bryan Cranston' };
    expect((await options(a.staff, a, body)).status).toBe(403);
    expect((await options(null, a, body)).status).toBe(401);
    expect((await options(b.owner, a, body)).status).toBe(404);
    for (const bad of [
      {},
      { correct: '' },
      { correct: 'x'.repeat(201) },
      { correct: 'x', extra: 1 },
      { correct: 'x', own: 'y' },
      { correct: 'x', own: Array.from({ length: 201 }, () => 'y') },
      { correct: 'x', own: ['y'.repeat(201)] },
      { correct: 'x', category: 'c'.repeat(81) },
      { correct: 5 },
    ])
      expect((await options(a.owner, a, bad)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
  });
});
