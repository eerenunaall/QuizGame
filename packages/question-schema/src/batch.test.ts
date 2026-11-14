import { describe, expect, it } from 'vitest';
import { auditBatch, formatSummary, summarize, summarizeFindings, type BatchItem } from './batch';
import { GOOD, NOW, subject } from './fixtures';
import { MemorySimilarityIndex } from './similarity';

const options = { now: NOW, sourceRequired: () => false };

/** n generated Turkish questions whose correct answer is at `position(i)` and which differ enough. */
function generated(
  n: number,
  position: (index: number) => number,
  stem?: (index: number) => string,
): BatchItem[] {
  const topics = [
    'Nehirler',
    'Dağlar',
    'Göller',
    'Adalar',
    'Şehirler',
    'Ülkeler',
    'Denizler',
    'Yarımadalar',
  ];
  return Array.from({ length: n }, (_, i) => {
    const correct = position(i);
    const words = ['Alfa', 'Beta', 'Gama', 'Delta'].map(
      (word) => `${word} ${topics[i % topics.length]} ${i}`,
    );
    return {
      key: `q${i}`,
      subject: subject(
        {
          text: stem
            ? stem(i)
            : `${topics[i % topics.length]} konusunda ${i}. soru için doğru olan hangisidir?`,
          options: words,
          correct,
        },
        { category: 'general' },
      ),
    };
  });
}

describe('correct answer positions', () => {
  it('passes a balanced batch', () => {
    const result = auditBatch(
      generated(80, (i) => i % 4),
      options,
    );
    expect(result.positions).toEqual([20, 20, 20, 20]);
    expect(result.batchFindings.filter((item) => item.code === 'CORRECT_POSITION_SKEW')).toEqual(
      [],
    );
    expect(result.positionPValue).toBeGreaterThan(0.99);
  });

  it('flags a batch where the answer sits in the same place too often', () => {
    const result = auditBatch(
      generated(80, (i) => (i % 10 < 5 ? 1 : i % 4)),
      options,
    );
    const skew = result.batchFindings.find((item) => item.code === 'CORRECT_POSITION_SKEW');
    expect(skew).toBeDefined();
    expect(result.positionPValue).toBeLessThan(0.01);
  });

  it('does not judge a batch that is too small to say anything', () => {
    const result = auditBatch(
      generated(12, () => 0),
      options,
    );
    expect(result.positionPValue).toBeNull();
    expect(result.batchFindings).toEqual([]);
  });

  it('notices when the correct answer is the longest option far too often', () => {
    const items = generated(80, (i) => i % 4).map((item) => ({
      ...item,
      subject: {
        ...item.subject,
        options: item.subject.options.map((option) => ({
          ...option,
          text: option.correct ? `${option.text} ve devamı` : option.text,
        })),
      },
    }));
    expect(auditBatch(items, options).batchFindings.map((item) => item.code)).toContain(
      'CORRECT_LONGEST_BIAS',
    );
  });
});

describe('repetition', () => {
  it('flags the copies of one opener beyond a quota, in input order, and no others', () => {
    const items = generated(
      40,
      (i) => i % 4,
      (i) =>
        i < 16
          ? `Aşağıdakilerden hangisi şu özelliği taşır: ${i}?`
          : `Konu ${i} hakkında ne söylenebilir ve neden?`,
    );
    const result = auditBatch(items, options);
    const flagged = result.items.filter((item) =>
      item.findings.some((finding) => finding.code === 'REPEATED_OPENER'),
    );
    expect(flagged.map((item) => item.key)).toEqual(
      Array.from({ length: 8 }, (_, i) => `q${i + 8}`),
    ); // quota = 20% of 40 = 8
  });

  it('flags the same template filled with different names', () => {
    const names = ['Ankara', 'Bursa', 'Konya', 'Sivas', 'Adana', 'Mersin', 'Van', 'Muğla'];
    const vocabulary = ['gezegen', 'mevsim', 'alfabe', 'müzik', 'sanat', 'mutfak', 'tarih', 'spor'];
    const distinct = (i: number) =>
      `${vocabulary[Math.floor(i / 8) % 8]} ile ${vocabulary[i % 8]} arasındaki fark nedir?`;
    const items = generated(
      30,
      (i) => i % 4,
      (i) => (i < 8 ? `${names[i]} şehrinin plaka kodu kaçtır, bilir misin?` : distinct(i)),
    );
    const result = auditBatch(items, options);
    const flagged = result.items.filter((item) =>
      item.findings.some((finding) => finding.code === 'TEMPLATE_REPEAT'),
    );
    expect(flagged.length).toBe(5); // 8 copies, quota 3
  });

  it('leaves small batches alone', () => {
    const result = auditBatch(
      generated(
        10,
        (i) => i % 4,
        (i) => `Aşağıdakilerden hangisi şu özelliği taşır: ${i}?`,
      ),
      options,
    );
    expect(
      result.items.flatMap((item) => item.findings).map((finding) => finding.code),
    ).not.toContain('REPEATED_OPENER');
  });
});

describe('duplicates inside a batch and against the bank', () => {
  it('flags the second copy of a question in the same batch but not the first', () => {
    const [first, second] = [GOOD[0]!, GOOD[0]!].map((item, i) => ({
      key: `row${i}`,
      subject: subject(item.draft, item.overrides),
    }));
    const result = auditBatch([first!, second!], {
      ...options,
      index: new MemorySimilarityIndex(),
    });
    expect(result.items[0]!.findings.map((item) => item.code)).not.toContain('DUPLICATE_LEXICAL');
    expect(result.items[1]!.findings.map((item) => item.code)).toContain('DUPLICATE_LEXICAL');
  });

  it('finds a copy of an already stored question', () => {
    const index = new MemorySimilarityIndex();
    const stored = auditBatch(
      [{ key: 'stored', subject: subject(GOOD[1]!.draft, GOOD[1]!.overrides) }],
      { ...options, index },
    );
    expect(stored.items[0]!.findings.map((item) => item.code)).not.toContain('DUPLICATE_LEXICAL');
    const again = auditBatch(
      [{ key: 'again', subject: subject(GOOD[1]!.draft, GOOD[1]!.overrides) }],
      { ...options, index },
    );
    expect(again.items[0]!.findings.map((item) => item.code)).toContain('DUPLICATE_LEXICAL');
  });
});

describe('summaries', () => {
  it('counts like the brief: 500 → 420 PASS / 58 REVIEW / 22 REJECT', () => {
    const outcomes = [
      ...Array.from({ length: 420 }, (_, i) => ({
        key: `p${i}`,
        status: 'PASS' as const,
        reasons: [],
      })),
      ...Array.from({ length: 58 }, (_, i) => ({
        key: `v${i}`,
        status: 'REVIEW' as const,
        reasons: ['NEGATIVE_STEM'],
      })),
      ...Array.from({ length: 22 }, (_, i) => ({
        key: `r${i}`,
        status: 'REJECT' as const,
        reasons: ['DUPLICATE_LEXICAL', 'NEAR_DUPLICATE'],
      })),
    ];
    const summary = summarize(outcomes);
    expect(formatSummary(summary)).toBe('500 → 420 PASS / 58 REVIEW / 22 REJECT');
    expect(summary.reasons).toEqual({
      NEGATIVE_STEM: 58,
      DUPLICATE_LEXICAL: 22,
      NEAR_DUPLICATE: 22,
    });
  });

  it('summarises findings by the worst severity and ignores INFO', () => {
    const result = auditBatch(
      [
        { key: 'clean', subject: subject(GOOD[0]!.draft, GOOD[0]!.overrides) },
        {
          key: 'unverified',
          subject: subject(GOOD[1]!.draft, { ...GOOD[1]!.overrides, lastVerifiedAt: null }),
        },
        {
          key: 'negated',
          subject: subject({
            text: 'Aşağıdakilerden hangisi bir Türk şehri değildir?',
            options: ['Paris', 'Bursa', 'Konya', 'Sivas'],
            correct: 0,
          }),
        },
        {
          key: 'broken',
          subject: subject({
            text: 'Başkenti Ankara olan ülke neresidir?',
            options: ['Ankara', 'ankara', 'Konya', 'Sivas'],
            correct: 0,
          }),
        },
      ],
      options,
    );
    const summary = summarizeFindings(
      result.items.map((item, i) => ({ ...item, category: i < 2 ? 'a' : 'b' })),
    );
    expect(summary).toMatchObject({ total: 4, pass: 2, review: 1, reject: 1 });
    expect(summary.byCategory).toEqual({
      a: { pass: 2, review: 0, reject: 0 },
      b: { pass: 0, review: 1, reject: 1 },
    });
  });
});
