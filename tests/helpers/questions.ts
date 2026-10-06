import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from '@quizparty/db';
import { ensureLaunchCategories } from '@quizparty/question-bank';

export const SEED_PATH = fileURLToPath(new URL('../../seed/questions.tr.jsonl', import.meta.url));
export const NOW = new Date('2026-10-06T12:00:00Z');

export type Row = Record<string, unknown> & {
  externalId: string;
  question: string;
  category: string;
};

/** The hand-written seed as raw rows (what `question import` reads). */
export function seedRows(): Row[] {
  return readFileSync(SEED_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row);
}

/** Categories whose launch policy does not require a source: clean seed rows stay free of findings there. */
export const FREE_OF_SOURCES = ['general', 'food-drink', 'language-words', 'math-logic'];

/** Eighty clean questions presented as human-written, so tests can import them without the dev-seed switch. */
export function cleanRows(count = 80, prefix = 'h'): Row[] {
  return seedRows()
    .filter((row) => FREE_OF_SOURCES.includes(row.category))
    .slice(0, count)
    .map((row) => ({ ...row, externalId: `${prefix}-${row.externalId}`, authorType: 'HUMAN' }));
}

export const jsonl = (rows: readonly unknown[]): string =>
  rows.map((row) => JSON.stringify(row)).join('\n');

export async function withCategories(db: Database): Promise<void> {
  await ensureLaunchCategories(db);
}

export async function countRows(
  db: Database,
  table: 'questions' | 'question_audits' | 'question_status_log',
): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
