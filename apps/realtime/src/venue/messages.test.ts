import { describe, expect, it } from 'vitest';
import { REASON_CODES, VENUE_FILE_ISSUE_CODES } from '@quizparty/question-schema';
import { catalogs } from '@quizparty/i18n';

/** Every code the upload pipeline can emit has a sentence in both languages (ADR-0025 §3). */
describe('venue upload messages', () => {
  const codes = [...VENUE_FILE_ISSUE_CODES, ...REASON_CODES];
  it.each(['tr', 'en'] as const)('%s covers every issue and audit reason code', (locale) => {
    const catalog = catalogs[locale] as Record<string, string>;
    const missing = codes.filter((code) => !catalog[`venue.issue.${code}`]);
    expect(missing).toEqual([]);
  });

  it('explains how to fix, not only what is wrong, for the commonest file problems', () => {
    const tr = catalogs.tr as Record<string, string>;
    expect(tr['venue.issue.file_excel']).toContain('CSV UTF-8');
    expect(tr['venue.issue.correct_missing']).toContain('A, B, C veya D');
    expect(tr['venue.issue.difficulty_invalid']).toContain('EASY');
  });
});
