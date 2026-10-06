import { describe, expect, it } from 'vitest';
import { catalogs, createTranslator, lower, resolveLocale, translate, upper } from './index';
import { tr } from './tr';

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('catalogs', () => {
  it('Turkish and English define exactly the same keys', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.tr).sort());
  });

  it('keeps placeholders identical between languages', () => {
    for (const key of Object.keys(tr) as (keyof typeof tr)[]) {
      expect(placeholders(catalogs.en[key]), key).toEqual(placeholders(catalogs.tr[key]));
    }
  });

  it('has no empty strings and the required reconnect copy from the brief', () => {
    for (const locale of ['tr', 'en'] as const) {
      for (const [key, value] of Object.entries(catalogs[locale]))
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
    }
    expect(catalogs.en['tv.reconnecting.title']).toBe('CONNECTION INTERRUPTED');
    expect(catalogs.en['tv.reconnecting.body']).toBe('TRYING TO RECONNECT…');
    expect(catalogs.en['ctl.reconnecting']).toBe('Reconnecting…');
    expect(catalogs.en['ctl.restored']).toBe('Game state restored.');
  });

  it('provides a message for every protocol error code', () => {
    const codes = Object.keys(tr).filter((key) => key.startsWith('error.'));
    expect(codes.length).toBeGreaterThanOrEqual(28);
  });

  it('never shows technical detail in user-facing copy', () => {
    for (const locale of ['tr', 'en'] as const) {
      for (const value of Object.values(catalogs[locale]))
        expect(value).not.toMatch(/stack|exception|undefined|null|\[object/i);
    }
  });
});

describe('translate', () => {
  it('substitutes placeholders and leaves unknown ones untouched', () => {
    expect(translate('tr', 'game.round', { n: 4 })).toBe('TUR 4');
    expect(translate('en', 'lobby.orVisit', { url: 'qp.example' })).toBe('or go to qp.example');
    expect(translate('en', 'lobby.orVisit')).toBe('or go to {url}');
  });

  it('chooses plural forms by locale', () => {
    expect(translate('en', 'lobby.players', { count: 1 })).toBe('1 player');
    expect(translate('en', 'lobby.players', { count: 3 })).toBe('3 players');
    expect(translate('tr', 'lobby.players', { count: 1 })).toBe('1 oyuncu');
    expect(translate('tr', 'lobby.players', { count: 3 })).toBe('3 oyuncu');
  });

  it('falls back to Turkish and then to the key', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key');
    expect(createTranslator('tr')('common.retry')).toBe('Tekrar dene');
  });
});

describe('locale helpers', () => {
  it('resolves browser language tags', () => {
    expect(resolveLocale('tr-TR')).toBe('tr');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('de-DE')).toBe('tr');
    expect(resolveLocale(null)).toBe('tr');
  });

  it('upper/lower-cases Turkish i correctly (ADR-0016)', () => {
    expect(upper('tr', 'istanbul')).toBe('İSTANBUL');
    expect(upper('tr', 'ışık')).toBe('IŞIK');
    expect(lower('tr', 'ISPARTA')).toBe('ısparta');
    expect(lower('tr', 'İZMİR')).toBe('izmir');
    expect(upper('en', 'istanbul')).toBe('ISTANBUL');
  });
});
