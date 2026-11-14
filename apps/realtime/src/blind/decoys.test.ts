import { describe, expect, it } from 'vitest';
import { CircuitBreaker, DecoyError, DecoySuggester, acceptDecoys, nearDuplicate } from './decoys';

const fakeClock = (start = 1_000) => {
  let now = start;
  return { clock: { now: () => now }, advance: (ms: number) => (now += ms) };
};

describe('acceptDecoys (the remote reply is untrusted)', () => {
  it('keeps clean, distinct options and drops the answer in disguise', () => {
    expect(
      acceptDecoys(
        { decoys: ['Pilot', 'pilot ', 'Doktor', 'Pilotluk', 'Aşçı'].slice(0, 3) },
        'Pilot',
      ),
    ).toEqual(['Doktor']);
    expect(acceptDecoys({ decoys: ['Doktor', 'Aşçı', 'Pilot'] }, 'pilot')).toEqual([
      'Doktor',
      'Aşçı',
    ]);
  });

  it('refuses every shape but the declared one', () => {
    for (const bad of [
      null,
      'Doktor',
      [],
      {},
      { decoys: [] },
      { decoys: ['a', 'b', 'c', 'd'] },
      { decoys: [1, 2] },
      { decoys: ['Doktor'], answer: 'Pilot' },
      { decoys: ['Doktor'], extra: true },
    ])
      expect(() => acceptDecoys(bad, 'Pilot')).toThrow(DecoyError);
  });

  it('sanitises like user text: links, control characters and nothing-left all fail', () => {
    expect(() =>
      acceptDecoys({ decoys: ['bak https://evil.example/x', '\u0007x', '  '] }, 'Pilot'),
    ).toThrow(DecoyError);
    expect(acceptDecoys({ decoys: ['  Doktor\n\tbey  '] }, 'Pilot')).toEqual(['Doktor bey']);
  });

  it('treats near duplicates as duplicates', () => {
    expect(nearDuplicate('Karnıyarık', 'karniyarik')).toBe(true); // foldCase drops diacritics
    expect(nearDuplicate('Karnıyarık', 'Karnıyarık yemeği')).toBe(true);
    expect(nearDuplicate('Mantı', 'Pilav')).toBe(false);
  });
});

describe('CircuitBreaker', () => {
  it('opens after three failures, probes once after the cool-down, closes on success', () => {
    const { clock, advance } = fakeClock();
    const breaker = new CircuitBreaker(clock, 3, 30_000);
    for (let i = 0; i < 3; i += 1) {
      expect(breaker.allow()).toBe(true);
      breaker.failure();
    }
    expect(breaker.allow()).toBe(false);
    advance(29_999);
    expect(breaker.allow()).toBe(false);
    advance(1);
    expect(breaker.allow()).toBe(true); // the probe
    expect(breaker.allow()).toBe(false); // nobody else while it is out
    breaker.failure(); // probe failed: open again for a full cool-down
    advance(29_000);
    expect(breaker.allow()).toBe(false);
    advance(1_000);
    expect(breaker.allow()).toBe(true);
    breaker.success();
    expect(breaker.allow()).toBe(true);
    expect(breaker.isOpen).toBe(false);
  });
});

describe('DecoySuggester', () => {
  const request = { language: 'tr', prompt: 'Soru?', answer: 'Cevap' } as const;
  it('falls back to no suggestions when off, unconfigured or failing', async () => {
    const seen: string[] = [];
    const record = (r: string) => seen.push(r);
    const provider = { propose: () => Promise.resolve(['x']) };
    expect(
      await new DecoySuggester({
        provider: null,
        enabled: () => Promise.resolve(true),
        record,
      }).suggest(request),
    ).toEqual({ decoys: [], source: 'NONE' });
    expect(
      await new DecoySuggester({ provider, enabled: () => Promise.resolve(false), record }).suggest(
        request,
      ),
    ).toEqual({ decoys: [], source: 'NONE' });
    expect(
      await new DecoySuggester({
        provider: { propose: () => Promise.reject(new Error('boom')) },
        enabled: () => Promise.resolve(true),
        record,
      }).suggest(request),
    ).toEqual({ decoys: [], source: 'NONE' });
    expect(
      await new DecoySuggester({ provider, enabled: () => Promise.resolve(true), record }).suggest(
        request,
      ),
    ).toEqual({ decoys: ['x'], source: 'AI' });
    expect(seen).toEqual(['OFF', 'OFF', 'UPSTREAM', 'OK']);
  });
});
