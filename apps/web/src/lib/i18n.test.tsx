import { describe, expect, it } from 'vitest';
import {
  AVATAR_IDS,
  CLOSE_REASONS,
  DIFFICULTIES,
  DIFFICULTY_PRESETS,
  ROUND_KINDS,
} from '@quizparty/protocol';
import { ERROR_CODE_LIST } from '@quizparty/protocol';
import { catalogs } from '@quizparty/i18n';
import { createStorage } from './storage';
import { pickLocale } from './i18n';

const storageWith = (locale?: 'tr' | 'en') => {
  const storage = createStorage(null);
  if (locale) void storage.set('qp.prefs', JSON.stringify({ volume: 0.5, muted: false, locale }));
  return storage;
};

describe('pickLocale', () => {
  it('prefers ?lang=, then the saved preference, then the browser, then Turkish', () => {
    expect(pickLocale('?lang=en', storageWith('tr'), 'tr-TR')).toBe('en');
    expect(pickLocale('', storageWith('en'), 'tr-TR')).toBe('en');
    expect(pickLocale('', storageWith(), 'en-GB')).toBe('en');
    expect(pickLocale('', storageWith(), 'de-DE')).toBe('tr');
    expect(pickLocale('', storageWith(), undefined)).toBe('tr');
  });

  it('ignores unsupported ?lang= values', () => {
    expect(pickLocale('?lang=fr', storageWith('en'), 'tr')).toBe('en');
  });
});

describe('keys the UI assembles at run time', () => {
  // `t('literal')` is checked by the compiler; `td(`prefix.${value}`)` is not, so every value that
  // can reach those templates must have a text in both languages.
  const NICKNAME_REASONS = [
    'EMPTY',
    'TOO_SHORT',
    'TOO_LONG',
    'FORBIDDEN_CHARACTER',
    'MIXED_SCRIPT',
    'TOO_MANY_EMOJI',
    'PROFANITY',
    'RESERVED',
  ];
  const AWARDS = ['SHARPSHOOTER', 'FASTEST_FINGER', 'STREAK_MASTER', 'COMEBACK'];
  const groups: Record<string, readonly string[]> = {
    'error.': ERROR_CODE_LIST,
    'game.difficulty.': DIFFICULTIES,
    'game.kind.': ROUND_KINDS,
    'settings.preset.': DIFFICULTY_PRESETS,
    'closed.': [...CLOSE_REASONS, 'SUPERSEDED'],
    'results.award.': AWARDS,
    'nickname.reason.': NICKNAME_REASONS,
    'avatar.': AVATAR_IDS,
  };

  for (const [prefix, values] of Object.entries(groups)) {
    it(`${prefix}* exists in Turkish and English for every value`, () => {
      for (const locale of ['tr', 'en'] as const) {
        const catalog = catalogs[locale] as Record<string, string | undefined>;
        const missing = values.filter((value) => !catalog[`${prefix}${value}`]);
        expect(missing, `${locale}: ${prefix}`).toEqual([]);
      }
    });
  }
});
