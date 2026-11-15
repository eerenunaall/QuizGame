import { describe, expect, it } from 'vitest';
import { suggestOptions } from './distractors';

/** A small deterministic generator, so every run is the same. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ACTORS = [
  'Aaron Paul',
  'Bob Odenkirk',
  'Anna Gunn',
  'Giancarlo Esposito',
  'Dean Norris',
  'Bryan Cranston',
  'Ankara',
  'Atatürk Havalimanı',
  '1923',
  'Kafe',
];

describe('suggestOptions', () => {
  it('puts the right answer at a random place among names that look like it', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const r = suggestOptions({
        correct: 'Bryan Cranston',
        candidates: ACTORS,
        random: seeded(seed),
      });
      expect(r.options).toHaveLength(4);
      expect(r.options[r.correctIndex]).toBe('Bryan Cranston');
      expect(new Set(r.options).size).toBe(4);
      expect(r.kind).toBe('TEXT');
      expect(r.missing).toBe(0);
      // Two-word names, not a city, a number or "Kafe".
      for (const o of r.options) expect(o).not.toMatch(/^(Ankara|1923|Kafe)$/u);
      // A 20-word list is mostly names, and names are what come out.
      expect(r.options.filter((o) => ACTORS.slice(0, 6).includes(o)).length).toBeGreaterThanOrEqual(
        3,
      );
      seen.add(r.correctIndex);
    }
    // All four places are used over many runs.
    expect(seen.size).toBe(4);
  });

  it('is exact for the same randomness and different for another', () => {
    const run = (seed: number) =>
      suggestOptions({ correct: 'Bryan Cranston', candidates: ACTORS, random: seeded(seed) });
    expect(run(7)).toEqual(run(7));
    expect(JSON.stringify(run(7))).not.toBe(JSON.stringify(run(8)));
  });

  it("prefers the owner's own list and says how many it used", () => {
    const r = suggestOptions({
      correct: 'Bryan Cranston',
      candidates: ACTORS,
      own: ['Hugh Laurie', 'Steve Carell', 'Jon Hamm'],
      random: seeded(3),
    });
    expect(r.fromOwn).toBe(3);
    expect(
      r.options.filter((o) => ['Hugh Laurie', 'Steve Carell', 'Jon Hamm'].includes(o)),
    ).toHaveLength(3);
  });

  it('never repeats the answer, even in another case or spelling, and skips look-alikes', () => {
    const r = suggestOptions({
      correct: 'Ankara Kalesi',
      candidates: [
        'ANKARA KALESİ',
        'ankara kalesi',
        'Ankara',
        'Kalesi',
        'İzmir Saat Kulesi',
        'Galata Kulesi',
        'Kız Kulesi',
        'Sümela Manastırı',
      ],
      random: seeded(5),
    });
    expect(r.options.filter((o) => /ankara/iu.test(o))).toEqual(['Ankara Kalesi']);
    expect(r.missing).toBe(0);
  });

  it('reports what it could not find instead of inventing it', () => {
    const r = suggestOptions({
      correct: 'Bryan Cranston',
      candidates: ['Aaron Paul', 'Bryan Cranston'],
      random: seeded(1),
    });
    expect(r.options).toHaveLength(2);
    expect(r.missing).toBe(2);
    expect(r.options[r.correctIndex]).toBe('Bryan Cranston');
    expect(suggestOptions({ correct: 'Bir', candidates: [], random: seeded(1) })).toMatchObject({
      options: ['Bir'],
      correctIndex: 0,
      missing: 3,
    });
  });

  it('makes near years, keeps units and thousands marks, and never goes below zero', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const year = suggestOptions({ correct: '1923', candidates: [], random: seeded(seed) });
      expect(year.kind).toBe('NUMBER');
      expect(year.options).toHaveLength(4);
      for (const o of year.options) expect(Math.abs(Number(o) - 1923)).toBeLessThanOrEqual(30);
      const metres = suggestOptions({ correct: '67 metre', candidates: [], random: seeded(seed) });
      for (const o of metres.options) expect(o).toMatch(/^\d+ metre$/u);
      expect(new Set(metres.options).size).toBe(4);
      const big = suggestOptions({ correct: '1.453', candidates: [], random: seeded(seed) });
      for (const o of big.options) expect(o).toMatch(/^\d{1,3}(\.\d{3})*$/u);
      const small = suggestOptions({ correct: '2', candidates: [], random: seeded(seed) });
      for (const o of small.options) expect(Number(o)).toBeGreaterThanOrEqual(0);
      expect(new Set(small.options).size).toBe(4);
      const dec = suggestOptions({ correct: '3,14', candidates: [], random: seeded(seed) });
      for (const o of dec.options) expect(o).toMatch(/^\d+,\d{2}$/u);
    }
  });

  it('is calm about junk and hostile input', () => {
    for (const correct of [
      '',
      '   ',
      'x'.repeat(5000),
      '9'.repeat(40),
      '\u0000‮',
      '1e999',
      '١٢٣',
    ]) {
      const r = suggestOptions({
        correct,
        candidates: ['a'.repeat(300), '', ' ', 'Bir', 'İki'],
        random: seeded(2),
      });
      expect(r.options.length).toBeGreaterThanOrEqual(1);
      expect(r.options.every((o) => o.length <= 200)).toBe(true);
      expect(r.options[r.correctIndex]).toBeDefined();
    }
    const many = Array.from({ length: 20000 }, (_, i) => `Aday ${i}`);
    const t0 = Date.now();
    suggestOptions({ correct: 'Aday X', candidates: many, random: seeded(4) });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
