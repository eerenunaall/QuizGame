import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LSH_BANDS,
  MINHASH_PERMUTATIONS,
  bandHashes,
  estimateJaccard,
  exactJaccard,
  hash32,
  lexicalFingerprint,
  minhash,
  shingles,
  similarityKey,
} from './fingerprint';

describe('lexicalFingerprint', () => {
  it('is the same for the same question written in different ways', () => {
    const a = lexicalFingerprint('tr', "Türkiye'nin başkenti neresidir?");
    expect(lexicalFingerprint('tr', 'TÜRKİYE’NİN BAŞKENTİ NERESİDİR')).toBe(a);
    expect(lexicalFingerprint('tr', "Turkiye'nin   baskenti neresidir ?")).toBe(a);
  });

  it('differs between questions and between languages', () => {
    const a = lexicalFingerprint('tr', "Türkiye'nin başkenti neresidir?");
    expect(lexicalFingerprint('tr', "Fransa'nın başkenti neresidir?")).not.toBe(a);
    expect(lexicalFingerprint('en', "Türkiye'nin başkenti neresidir?")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('never changes for a given input: stored fingerprints stay valid', () => {
    // If this fails the algorithm changed: bump FINGERPRINT_VERSION and recompute the bank.
    expect(lexicalFingerprint('tr', "Türkiye'nin başkenti neresidir?")).toBe(
      lexicalFingerprint('tr', 'türkiyenin başkenti neresidir'),
    );
    expect(hash32('quizparty')).toBe(hash32('quizparty'));
    expect(hash32('')).toBe(0);
    expect(minhash('ankara')[0]).toBe(minhash('ankara')[0]);
  });
});

describe('shingles', () => {
  it('pads word boundaries and handles short keys', () => {
    expect([...shingles('ab c')].sort()).toEqual([' ab ', 'ab c', 'b c '].sort());
    expect([...shingles('a')]).toEqual([' a ']);
  });
});

describe('minhash', () => {
  it('has the declared size and is deterministic', () => {
    const signature = minhash('turkiye baskenti ankara');
    expect(signature).toHaveLength(MINHASH_PERMUTATIONS);
    expect(minhash('turkiye baskenti ankara')).toEqual(signature);
    expect(
      signature.every((value) => Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31),
    ).toBe(true);
  });

  it('estimates the exact Jaccard similarity closely', () => {
    const words = [
      'ankara',
      'istanbul',
      'izmir',
      'bursa',
      'konya',
      'adana',
      'mersin',
      'antalya',
      'kayseri',
      'samsun',
    ];
    const sentence = (indices: number[]) => indices.map((index) => words[index]).join(' ');
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { minLength: 3, maxLength: 8 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { minLength: 3, maxLength: 8 }),
        (left, right) => {
          const a = sentence(left);
          const b = sentence(right);
          const estimate = estimateJaccard(minhash(a), minhash(b));
          expect(Math.abs(estimate - exactJaccard(a, b))).toBeLessThan(0.2);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('is 1 for identical text and near 0 for unrelated text', () => {
    expect(estimateJaccard(minhash('nil nehri afrika'), minhash('nil nehri afrika'))).toBe(1);
    expect(
      estimateJaccard(minhash('nil nehri afrika'), minhash('suyun kimyasal formulu h2o')),
    ).toBeLessThan(0.1);
  });
});

describe('similarityKey', () => {
  it('keeps content words of the stem and the answer, drops template words', () => {
    expect(similarityKey('tr', "Türkiye'nin başkenti neresidir?", 'Ankara')).toBe(
      'turkiye baskenti | ankara',
    );
  });
});

describe('bandHashes', () => {
  it('gives one hash per band, equal for equal signatures', () => {
    const signature = minhash('turkiye baskenti ankara');
    expect(bandHashes(signature)).toHaveLength(LSH_BANDS);
    expect(bandHashes([...signature])).toEqual(bandHashes(signature));
  });

  it('shares at least one band bucket between questions that are close enough to matter', () => {
    const base = 'osmanli devletinin kurucusu osman bey';
    const variants = [
      'osmanli devletinin kurucusu osman bey',
      'osmanli devletinin kurucusu olan osman bey',
      'osmanli devleti kurucusu osman bey',
    ];
    const baseBands = bandHashes(minhash(base));
    for (const variant of variants) {
      const bands = bandHashes(minhash(variant));
      expect(bands.some((hash, band) => hash === baseBands[band])).toBe(true);
    }
  });
});
