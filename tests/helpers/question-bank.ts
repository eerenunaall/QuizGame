import type { Database } from '@quizparty/db';
import {
  importQuestions,
  loadQuestion,
  parseImportText,
  runAudit,
  type ImportOptions,
} from '@quizparty/question-bank';
import { panel } from './audit';
import { cleanRows, jsonl, NOW, type Row } from './questions';

/** Imports the rows and returns the new ids in the order of the rows (not the order of the database). */
export async function importRows(
  db: Database,
  rows: readonly Row[],
  options: Partial<ImportOptions> = {},
): Promise<string[]> {
  await importQuestions(db, parseImportText(jsonl(rows), 'jsonl'), { now: NOW, ...options });
  const stored = await db.selectFrom('questions').select(['id', 'external_id']).execute();
  const byExternalId = new Map(stored.map((row) => [row.external_id, row.id]));
  return rows.map((row) => byExternalId.get(row.externalId)!);
}

export const importClean = (db: Database, count: number, prefix = 'h'): Promise<string[]> =>
  importRows(db, cleanRows(count, prefix));

export async function statusCounts(db: Database): Promise<Record<string, number>> {
  const rows = await db
    .selectFrom('questions')
    .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('status')
    .execute();
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
}

export async function auditCount(db: Database): Promise<number> {
  const row = await db
    .selectFrom('question_audits')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export const logOf = (db: Database, id: string) =>
  db
    .selectFrom('question_status_log')
    .select(['from_status', 'to_status', 'actor_account_id', 'reason', 'detail'])
    .where('question_id', '=', id)
    .orderBy('id')
    .execute();

/** Clean questions taken all the way to ACTIVE through the real pipeline (scripted auditors, real arbiter). */
export async function activate(db: Database, count: number, prefix = 'a'): Promise<string[]> {
  const ids = await importClean(db, count, prefix);
  await runAudit(db, ids, { now: NOW, providers: panel(), autoActivate: true });
  return ids;
}

/** Question text → index of the right option, as stored (the text is normalised on import). */
export async function answerKey(
  db: Database,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const key = new Map<string, number>();
  for (const id of ids) {
    const stored = (await loadQuestion(db, id))!;
    key.set(
      stored.question.text,
      stored.question.options.findIndex((option) => option.correct),
    );
  }
  return key;
}
