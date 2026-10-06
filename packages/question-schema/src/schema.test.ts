import { describe, expect, it } from 'vitest';
import { parseImportRow, toImportRow } from './schema';

const valid = {
  externalId: 'tr-geo-001',
  category: 'geography',
  difficulty: 'MEDIUM',
  question: 'Nil Nehri hangi kıtada yer alır?',
  options: ['Afrika', 'Asya', 'Güney Amerika', 'Avrupa'],
  correctIndex: 0,
  explanation: 'Nil, Afrika’nın kuzeydoğusundan Akdeniz’e akar.',
  authorType: 'HUMAN',
};

const issuesOf = (row: unknown): string[] => {
  const parsed = parseImportRow(row);
  return parsed.ok ? [] : parsed.issues.map((issue) => `${issue.path}:${issue.code}`);
};

describe('parseImportRow', () => {
  it('normalises a valid row and applies defaults', () => {
    const parsed = parseImportRow(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.question).toMatchObject({
      language: 'tr',
      pool: 'EVERGREEN',
      sources: [],
      expiresAt: null,
      subcategory: null,
    });
    expect(parsed.question.options.map((option) => option.correct)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(parsed.question.explanation).toBe("Nil, Afrika'nın kuzeydoğusundan Akdeniz'e akar."); // one apostrophe
  });

  it('cleans text: invisible characters, odd spaces, composition', () => {
    const parsed = parseImportRow({
      ...valid,
      question: '  Nil\u200B   Nehri hangi  kıtada\u00A0yer alır?  ',
    });
    expect(parsed.ok && parsed.question.text).toBe('Nil Nehri hangi kıtada yer alır?');
  });

  it('rejects unknown fields instead of dropping them silently', () => {
    expect(issuesOf({ ...valid, difficulty_level: 3 })).toContain(':unknown_field');
  });

  it('rejects structural mistakes with machine-readable codes', () => {
    expect(issuesOf({ ...valid, correctIndex: 4 })).toContain(
      'correctIndex:correct_index_out_of_range',
    );
    expect(
      issuesOf({ ...valid, options: ['Tek'], correctIndex: 0 }).some((issue) =>
        issue.startsWith('options'),
      ),
    ).toBe(true);
    expect(
      issuesOf({ ...valid, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).some((issue) =>
        issue.startsWith('options'),
      ),
    ).toBe(true);
    expect(issuesOf({ ...valid, question: 'Kısa?' })).toContain('question:too_short');
    expect(issuesOf({ ...valid, question: 'x'.repeat(401) })).toContain('question:too_long');
    expect(
      issuesOf({ ...valid, difficulty: 'IMPOSSIBLE' }).some((issue) =>
        issue.startsWith('difficulty'),
      ),
    ).toBe(true);
    expect(issuesOf({ ...valid, category: 'Tarih Bilgisi' })).toContain(
      'category:invalid_category',
    );
    expect(issuesOf({ ...valid, externalId: 'has space' })).toContain(
      'externalId:invalid_external_id',
    );
    expect(
      issuesOf({ ...valid, authorType: undefined }).some((issue) => issue.startsWith('authorType')),
    ).toBe(true);
    expect(issuesOf('not an object')).not.toEqual([]);
    expect(issuesOf(null)).not.toEqual([]);
  });

  it('requires an expiry for current-event questions and accepts dates', () => {
    expect(issuesOf({ ...valid, pool: 'CURRENT' })).toContain('expiresAt:current_needs_expiry');
    const parsed = parseImportRow({
      ...valid,
      pool: 'CURRENT',
      expiresAt: '2026-12-31',
      lastVerifiedAt: '2026-10-01T08:00:00Z',
    });
    expect(parsed.ok && parsed.question.expiresAt?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(issuesOf({ ...valid, expiresAt: 'tomorrow' })).toContain('expiresAt:invalid_date');
    expect(issuesOf({ ...valid, expiresAt: '2026-13-45' })).toContain('expiresAt:invalid_date');
  });

  it('accepts only plain http(s) sources without credentials', () => {
    const ok = parseImportRow({
      ...valid,
      sources: [{ url: 'https://tr.wikipedia.org/wiki/Nil', title: 'Nil' }],
    });
    expect(ok.ok).toBe(true);
    for (const url of [
      'javascript:alert(1)',
      'ftp://example.com/x',
      'https://user:pw@example.com/',
      'not a url',
    ])
      expect(issuesOf({ ...valid, sources: [{ url }] })).toContain('sources.0.url:invalid_url');
  });

  it('round-trips through the export shape', () => {
    const parsed = parseImportRow({
      ...valid,
      sources: [{ url: 'https://tr.wikipedia.org/wiki/Nil' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const again = parseImportRow(toImportRow(parsed.question));
    expect(again.ok && again.question).toEqual(parsed.question);
  });
});
