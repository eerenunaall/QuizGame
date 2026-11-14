import { z } from 'zod';
import {
  AUTHOR_TYPES,
  DIFFICULTIES,
  EXPLANATION_MAX,
  MAX_OPTIONS,
  MIN_OPTIONS,
  OPTION_TEXT_MAX,
  POOLS,
  QUESTION_LANGUAGES,
  QUESTION_TEXT_MAX,
  QUESTION_TEXT_MIN,
  type AuthorType,
  type Difficulty,
  type Pool,
  type QuestionLanguage,
} from './enums';
import { parseUrl } from './runtime';
import { cleanText } from './text';

/**
 * The import contract for a question (docs/QUESTION_QUALITY.md §11: never accept prose-only
 * output). One JSON object per line (JSONL) or one CSV row; both end up here. Unknown fields are
 * rejected so a typo in a generator's output cannot silently drop data.
 */
const cleaned = (min: number, max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(min, { error: 'too_short' }).max(max, { error: 'too_long' }));

const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u,
    {
      error: 'invalid_date',
    },
  )
  .transform((value, context) => {
    const date = new Date(
      value.includes('T') || value.includes(' ') ? value.replace(' ', 'T') : `${value}T00:00:00Z`,
    );
    if (Number.isNaN(date.getTime())) {
      context.issues.push({ code: 'custom', message: 'invalid_date', input: value });
      return z.NEVER;
    }
    return date;
  });

const SourceSchema = z.strictObject({
  url: z
    .string()
    .max(500)
    .refine(
      (value) => {
        try {
          const url = parseUrl(value);
          return (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      },
      { error: 'invalid_url' },
    ),
  title: cleaned(1, 200).optional(),
  retrievedAt: isoDate.optional(),
});

export const QuestionImportSchema = z
  .strictObject({
    externalId: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,64}$/u, { error: 'invalid_external_id' })
      .optional(),
    language: z.enum(QUESTION_LANGUAGES).default('tr'),
    category: z.string().regex(/^[a-z0-9-]{1,40}$/u, { error: 'invalid_category' }),
    subcategory: cleaned(1, 80).nullish(),
    topic: cleaned(1, 120).nullish(),
    difficulty: z.enum(DIFFICULTIES),
    question: cleaned(QUESTION_TEXT_MIN, QUESTION_TEXT_MAX),
    options: z.array(cleaned(1, OPTION_TEXT_MAX)).min(MIN_OPTIONS).max(MAX_OPTIONS),
    correctIndex: z.number().int().min(0),
    explanation: cleaned(1, EXPLANATION_MAX).nullish(),
    sources: z.array(SourceSchema).max(8).default([]),
    pool: z.enum(POOLS).default('EVERGREEN'),
    expiresAt: isoDate.nullish(),
    lastVerifiedAt: isoDate.nullish(),
    authorType: z.enum(AUTHOR_TYPES),
  })
  .superRefine((row, context) => {
    if (row.correctIndex >= row.options.length)
      context.addIssue({
        code: 'custom',
        path: ['correctIndex'],
        message: 'correct_index_out_of_range',
      });
    if (row.pool === 'CURRENT' && !row.expiresAt)
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'current_needs_expiry' });
  });

export type QuestionImportRow = z.output<typeof QuestionImportSchema>;

export interface NormalizedQuestion {
  externalId: string | null;
  language: QuestionLanguage;
  category: string;
  subcategory: string | null;
  topic: string | null;
  difficulty: Difficulty;
  text: string;
  explanation: string | null;
  options: { text: string; correct: boolean }[];
  sources: { url: string; title: string | null; retrievedAt: Date | null }[];
  pool: Pool;
  expiresAt: Date | null;
  lastVerifiedAt: Date | null;
  authorType: AuthorType;
}

export interface ImportIssue {
  /** Dotted path inside the row, e.g. `options.2` or `correctIndex`; empty for whole-row problems. */
  path: string;
  /** Short machine code: a zod code or one of our own (`correct_index_out_of_range`, …). */
  code: string;
}

export type ParsedRow =
  { ok: true; question: NormalizedQuestion } | { ok: false; issues: ImportIssue[] };

export function normalizeRow(row: QuestionImportRow): NormalizedQuestion {
  return {
    externalId: row.externalId ?? null,
    language: row.language,
    category: row.category,
    subcategory: row.subcategory ?? null,
    topic: row.topic ?? null,
    difficulty: row.difficulty,
    text: row.question,
    explanation: row.explanation ?? null,
    options: row.options.map((text, index) => ({ text, correct: index === row.correctIndex })),
    sources: row.sources.map((source) => ({
      url: source.url,
      title: source.title ?? null,
      retrievedAt: source.retrievedAt ?? null,
    })),
    pool: row.pool,
    expiresAt: row.expiresAt ?? null,
    lastVerifiedAt: row.lastVerifiedAt ?? null,
    authorType: row.authorType,
  };
}

/** Validates one raw row (already JSON-parsed). Never throws; issues are machine-readable. */
export function parseImportRow(raw: unknown): ParsedRow {
  const parsed = QuestionImportSchema.safeParse(raw);
  if (parsed.success) return { ok: true, question: normalizeRow(parsed.data) };
  const issues: ImportIssue[] = parsed.error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    let code: string = issue.code;
    if (issue.code === 'custom' && issue.message) code = issue.message;
    else if (issue.code === 'unrecognized_keys') code = 'unknown_field';
    else if (issue.message && /^[a-z_]+$/u.test(issue.message)) code = issue.message;
    return { path, code };
  });
  return { ok: false, issues };
}

/** The inverse of the import contract: used by exports (manual audit batches, backups). */
export function toImportRow(question: NormalizedQuestion): Record<string, unknown> {
  const correctIndex = question.options.findIndex((option) => option.correct);
  return {
    ...(question.externalId ? { externalId: question.externalId } : {}),
    language: question.language,
    category: question.category,
    ...(question.subcategory ? { subcategory: question.subcategory } : {}),
    ...(question.topic ? { topic: question.topic } : {}),
    difficulty: question.difficulty,
    question: question.text,
    options: question.options.map((option) => option.text),
    correctIndex,
    ...(question.explanation ? { explanation: question.explanation } : {}),
    ...(question.sources.length > 0
      ? {
          sources: question.sources.map((source) => ({
            url: source.url,
            ...(source.title ? { title: source.title } : {}),
            ...(source.retrievedAt ? { retrievedAt: source.retrievedAt.toISOString() } : {}),
          })),
        }
      : {}),
    pool: question.pool,
    ...(question.expiresAt ? { expiresAt: question.expiresAt.toISOString() } : {}),
    ...(question.lastVerifiedAt ? { lastVerifiedAt: question.lastVerifiedAt.toISOString() } : {}),
    authorType: question.authorType,
  };
}
