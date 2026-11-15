import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { containsProfanity } from '@quizparty/validation';
import { auditBatch, type BatchItem } from './batch';
import { MemorySimilarityIndex } from './similarity';
import { parseImportRow, type NormalizedQuestion } from './schema';

/**
 * TEMPORARY demo bank (seed/demo, see seed/demo/README.md): cult-TV/film categories kept outside the
 * real pool. Held to the same rubric as the main dev seed so removing or extending it never leaves
 * a half-clean file behind. Delete this test together with seed/demo.
 */
const NOW = new Date('2026-10-18T12:00:00Z');
const read = (name: string): string =>
  readFileSync(new URL(`../../../seed/demo/${name}`, import.meta.url), 'utf8');
const categories = JSON.parse(read('categories.json')) as { id: string; tr: string; en: string }[];
const parsed = read('questions.cult.tr.jsonl')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => parseImportRow(JSON.parse(line) as unknown));
const questions: NormalizedQuestion[] = parsed.flatMap((result) =>
  result.ok ? [result.question] : [],
);

describe('the temporary demo bank', () => {
  it('is valid dev-seed content with a demo- id prefix, 25 questions per category', () => {
    expect(questions).toHaveLength(parsed.length);
    expect(questions.every((q) => q.authorType === 'DEV_SEED')).toBe(true);
    expect(questions.every((q) => q.externalId?.startsWith('demo-tr-'))).toBe(true);
    expect(new Set(questions.map((q) => q.externalId)).size).toBe(questions.length);
    expect(categories).toHaveLength(11);
    for (const category of categories) {
      expect(category.tr.length).toBeGreaterThan(0);
      expect(category.en.length).toBeGreaterThan(0);
      expect({
        id: category.id,
        count: questions.filter((q) => q.category === category.id).length,
      }).toEqual({ id: category.id, count: 25 });
    }
    expect(questions.every((q) => categories.some((c) => c.id === q.category))).toBe(true);
  });

  it('passes the audit without a single finding and says nothing the profanity filter refuses', () => {
    const items: BatchItem[] = questions.map((q) => ({
      key: q.externalId ?? q.text,
      subject: {
        language: q.language,
        category: q.category,
        difficulty: q.difficulty,
        text: q.text,
        explanation: q.explanation,
        options: q.options,
        pool: q.pool,
        expiresAt: q.expiresAt,
        lastVerifiedAt: q.lastVerifiedAt,
        sourceCount: q.sources.length,
        authorType: q.authorType,
      },
    }));
    const audit = auditBatch(items, {
      now: NOW,
      sourceRequired: () => false,
      index: new MemorySimilarityIndex(),
    });
    expect(
      audit.items.flatMap((item) =>
        item.findings.filter((f) => f.severity !== 'INFO').map((f) => `${item.key}: ${f.code}`),
      ),
    ).toEqual([]);
    expect(audit.batchFindings).toEqual([]);
    expect(
      questions.filter((q) =>
        [q.text, ...q.options.map((o) => o.text)].some((text) => containsProfanity(text)),
      ),
    ).toEqual([]);
  });
});
