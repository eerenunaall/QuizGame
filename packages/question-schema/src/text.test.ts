import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cleanText, contentTokens, foldKey, foldTokens, lowerForLanguage } from './text';

describe('cleanText', () => {
  it('composes Unicode and keeps every letter', () => {
    expect(cleanText('ü')).toBe('ü');
    expect(cleanText('Çalıkuşu romanı')).toBe('Çalıkuşu romanı');
  });

  it('removes invisible and bidirectional characters and collapses whitespace', () => {
    expect(cleanText('  Ankara\u200B\u00A0 \t başkent\u202E\n\uFEFF ')).toBe('Ankara başkent');
    expect(cleanText('a\u0007b')).toBe('ab');
  });

  it('uses one apostrophe so Turkish suffixes compare equal', () => {
    expect(cleanText('Ankara’nın ‘başkenti’ ʼ ´')).toBe("Ankara'nın 'başkenti' ' '");
  });
});

describe('lowerForLanguage', () => {
  it('follows the Turkish rule for dotted and dotless i', () => {
    expect(lowerForLanguage('IRAK İSPARTA ışık', 'tr')).toBe('ırak isparta ışık');
    expect(lowerForLanguage('İ', 'tr')).toBe('i');
    expect(lowerForLanguage('I', 'tr')).toBe('ı');
  });

  it('uses the default rule for English', () => {
    expect(lowerForLanguage('ISPARTA', 'en')).toBe('isparta');
  });
});

describe('foldKey', () => {
  it('makes case, diacritics, punctuation and spacing irrelevant', () => {
    const variants = [
      "Türkiye'nin başkenti neresidir?",
      'TÜRKİYE’NİN BAŞKENTİ NERESİDİR?',
      'turkiyenin   baskenti neresidir',
      "Turkiye'nin baskenti neresidir ?",
    ];
    const keys = new Set(variants.map((variant) => foldKey(variant, 'tr')));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('turkiyenin baskenti neresidir');
  });

  it('keeps IRAK and ırak together but apart from a different word', () => {
    expect(foldKey('IRAK', 'tr')).toBe(foldKey('ırak', 'tr'));
    expect(foldKey('Irak', 'tr')).not.toBe(foldKey('İran', 'tr'));
  });

  it('can split apostrophe suffixes for token matching', () => {
    expect(foldKey("Ankara'nın", 'tr', { apostrophes: 'split' })).toBe('ankara nin');
    expect(foldTokens("Ankara'nın başkenti", 'tr')).toEqual(['ankara', 'nin', 'baskenti']);
  });

  it('folds Latin extras', () => {
    expect(foldKey('Søren Łódź Straße', 'en')).toBe('soren lodz strasse');
  });

  it('is stable: folding twice changes nothing, and case never matters', () => {
    const turkish = fc.stringMatching(/^[a-zA-ZçğıİöşüÇĞÖŞÜ0-9 '’.,?!-]{0,60}$/u);
    fc.assert(
      fc.property(turkish, (text) => {
        const once = foldKey(text, 'tr');
        expect(foldKey(once, 'tr')).toBe(once);
        expect(foldKey(text.toLocaleUpperCase('tr'), 'tr')).toBe(once);
        expect(foldKey(text.toLocaleLowerCase('tr'), 'tr')).toBe(once);
      }),
      { numRuns: 300 },
    );
  });
});

describe('contentTokens', () => {
  it('drops template words so two templates do not look alike', () => {
    expect(contentTokens('Hangi ülkenin başkenti Roma’dır?', 'tr')).toEqual([
      'ulkenin',
      'baskenti',
      'roma',
    ]);
    expect(contentTokens('Which city is the capital of Italy?', 'en')).toEqual([
      'city',
      'capital',
      'italy',
    ]);
  });
});
