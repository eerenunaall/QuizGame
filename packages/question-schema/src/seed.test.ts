import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { containsProfanity } from '@quizparty/validation';
import { auditBatch, type BatchItem } from './batch';
import { lexicalFingerprint } from './fingerprint';
import { MemorySimilarityIndex } from './similarity';
import { parseImportRow, type NormalizedQuestion } from './schema';
import { chiSquareSurvival } from './stats';

/**
 * The hand-written development bank (seed/questions.tr.jsonl): 340 Turkish questions, twenty in
 * each of the seventeen launch categories. It is the only content the application may serve
 * without the audit pipeline (dev-seed, never in production), so it is held to the same rubric as
 * anything the pipeline would approve: no finding of any severity, balanced answer positions, no
 * duplicates, nothing the profanity filter would stop a player from typing.
 */
const NOW = new Date('2026-10-06T12:00:00Z');
const lines = readFileSync(new URL('../../../seed/questions.tr.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');

const parsed = lines.map((line) => parseImportRow(JSON.parse(line) as unknown));
const questions: NormalizedQuestion[] = parsed.flatMap((result) =>
  result.ok ? [result.question] : [],
);

describe('the development seed', () => {
  it('has 340 valid rows, written as development content with stable ids', () => {
    expect(lines).toHaveLength(340);
    expect(
      parsed
        .filter((result) => !result.ok)
        .map((result) => (result.ok ? '' : JSON.stringify(result.issues))),
    ).toEqual([]);
    expect(new Set(questions.map((question) => question.externalId)).size).toBe(340);
    expect(questions.every((question) => question.authorType === 'DEV_SEED')).toBe(true);
    expect(questions.every((question) => question.language === 'tr')).toBe(true);
    expect(questions.every((question) => question.pool === 'EVERGREEN')).toBe(true);
  });

  it('covers the seventeen launch categories evenly and every difficulty in each', () => {
    const perCategory = new Map<string, NormalizedQuestion[]>();
    for (const question of questions)
      perCategory.set(question.category, [...(perCategory.get(question.category) ?? []), question]);
    expect(perCategory.size).toBe(17);
    for (const [category, list] of perCategory) {
      expect({ category, count: list.length }).toEqual({ category, count: 20 });
      const levels = new Set(list.map((question) => question.difficulty));
      expect({ category, levels: [...levels].sort() }).toEqual({
        category,
        levels: ['EASY', 'EXPERT', 'HARD', 'MEDIUM'],
      });
    }
  });

  it('has no duplicate wording and no two questions answered by the same fact', () => {
    const index = new MemorySimilarityIndex();
    const fingerprints = new Set(
      questions.map((question) => lexicalFingerprint(question.language, question.text)),
    );
    expect(fingerprints.size).toBe(340);
    const items: BatchItem[] = questions.map((question) => ({
      key: question.externalId ?? question.text,
      subject: {
        language: question.language,
        category: question.category,
        difficulty: question.difficulty,
        text: question.text,
        explanation: question.explanation,
        options: question.options,
        pool: question.pool,
        expiresAt: question.expiresAt,
        lastVerifiedAt: question.lastVerifiedAt,
        sourceCount: question.sources.length,
        authorType: question.authorType,
      },
    }));
    const audit = auditBatch(items, { now: NOW, sourceRequired: () => false, index });
    const flagged = audit.items.flatMap((item) =>
      item.findings
        .filter((finding) => finding.severity !== 'INFO')
        .map((finding) => `${item.key}: ${finding.code}`),
    );
    expect(flagged).toEqual([]);
    expect(audit.batchFindings).toEqual([]);
  });

  it('spreads the right answer over the positions as chance would, not as a habit would', () => {
    const counts = [0, 0, 0, 0];
    for (const question of questions)
      counts[question.options.findIndex((option) => option.correct)]!++;
    expect(counts.every((count) => count > 0)).toBe(true);
    const expected = questions.length / 4;
    const statistic = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    expect(chiSquareSurvival(statistic, 3)).toBeGreaterThan(0.05);
    // Not one category may lean on a single position either.
    const byCategory = new Map<string, number[]>();
    for (const question of questions) {
      const row = byCategory.get(question.category) ?? [0, 0, 0, 0];
      row[question.options.findIndex((option) => option.correct)]!++;
      byCategory.set(question.category, row);
    }
    for (const [category, row] of byCategory)
      expect({ category, max: Math.max(...row) <= 11 }).toEqual({ category, max: true });
  });

  it('says nothing the profanity filter would refuse a player', () => {
    const offending: string[] = [];
    for (const question of questions) {
      const texts = [
        question.text,
        question.explanation ?? '',
        ...question.options.map((option) => option.text),
      ];
      for (const text of texts)
        if (text && containsProfanity(text)) offending.push(`${question.externalId}: ${text}`);
    }
    expect(offending).toEqual([]);
  });

  it('keeps every option short enough for a phone button and every stem short enough for a TV', () => {
    for (const question of questions) {
      expect({ id: question.externalId, ok: question.text.length <= 160 }).toEqual({
        id: question.externalId,
        ok: true,
      });
      for (const option of question.options)
        expect({ id: question.externalId, ok: option.text.length <= 60 }).toEqual({
          id: question.externalId,
          ok: true,
        });
    }
  });
});
