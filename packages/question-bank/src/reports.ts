import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import { cleanText } from '@quizparty/question-schema';
import { sanitizeUserText } from '@quizparty/validation';
import { LifecycleError, SYSTEM_ACTOR, transitionTx, type Actor } from './lifecycle';

export const REPORT_REASONS = [
  'WRONG_ANSWER',
  'MULTIPLE_CORRECT',
  'OUTDATED',
  'TYPO',
  'OFFENSIVE',
  'UNCLEAR',
  'DUPLICATE',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportPolicy {
  /** Distinct open reporters that pull a question back to REVIEW. */
  demoteAtReporters: number;
  /** The same for reports of a serious kind (wrong answer, two answers, offensive). */
  demoteAtSeriousReporters: number;
}

export const DEFAULT_REPORT_POLICY: ReportPolicy = {
  demoteAtReporters: 3,
  demoteAtSeriousReporters: 2,
};

export interface ReportInput {
  questionId: string;
  /** Keyed pseudonym of the reporting room session: never a nickname, never an address. */
  reporterHash: string;
  roomId?: string | null;
  reason: ReportReason;
  note?: string | null;
}

export interface ReportOutcome {
  created: boolean;
  openReporters: number;
  demoted: boolean;
}

/**
 * Records a player's report (GDD §25 `question_reported`). One report per reporter per question:
 * reporting again only updates the reason. Enough independent reports pull an ACTIVE question back
 * to REVIEW at once, without waiting for a moderator (rubric §9: telemetry can move ACTIVE → REVIEW).
 */
export async function submitReport(
  db: Database,
  input: ReportInput,
  policy: ReportPolicy = DEFAULT_REPORT_POLICY,
): Promise<ReportOutcome> {
  let note: string | null = null;
  if (input.note) {
    const checked = sanitizeUserText(cleanText(input.note), { maxLength: 300 });
    note = checked.ok ? checked.text : null; // a note with a link or profanity is dropped, the report stays
  }
  return db.transaction().execute(async (trx) => {
    const question = await trx
      .selectFrom('questions')
      .select(['id', 'revision', 'status', 'is_dev_seed'])
      .where('id', '=', input.questionId)
      .executeTakeFirst();
    if (!question) throw new LifecycleError('NOT_FOUND');
    const row = await trx
      .insertInto('question_reports')
      .values({
        question_id: input.questionId,
        question_revision: question.revision,
        reporter_hash: input.reporterHash,
        room_id: input.roomId ?? null,
        reason: input.reason,
        note,
      })
      .onConflict((conflict) =>
        conflict.columns(['question_id', 'reporter_hash']).doUpdateSet({
          reason: input.reason,
          note,
          question_revision: question.revision,
        }),
      )
      .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
      .executeTakeFirstOrThrow();
    const counts = await trx
      .selectFrom('question_reports')
      .select([
        sql<number>`count(*) filter (where status = 'OPEN')::int`.as('open'),
        sql<number>`count(*) filter (where status = 'OPEN' and reason in ('WRONG_ANSWER', 'MULTIPLE_CORRECT', 'OFFENSIVE'))::int`.as(
          'serious',
        ),
      ])
      .where('question_id', '=', input.questionId)
      .executeTakeFirstOrThrow();
    let demoted = false;
    const inPlay = question.status === 'ACTIVE' || question.status === 'APPROVED';
    if (
      inPlay &&
      !question.is_dev_seed &&
      (counts.open >= policy.demoteAtReporters || counts.serious >= policy.demoteAtSeriousReporters)
    ) {
      await transitionTx(trx, input.questionId, 'REVIEW', {
        actor: SYSTEM_ACTOR,
        reason: 'REPORT_THRESHOLD',
        detail: { openReporters: counts.open, serious: counts.serious },
      });
      demoted = true;
    }
    return { created: row.inserted, openReporters: counts.open, demoted };
  });
}

export type ReportAction = 'DISMISS' | 'SEND_TO_REVIEW' | 'RETIRE' | 'MARK_FIXED';

export interface ResolveResult {
  resolved: number;
  questionStatus: string;
}

const MODERATION_ROLES = ['ADMIN', 'EDITOR', 'MODERATOR'] as const;

/**
 * A moderator's decision on a report. SEND_TO_REVIEW and RETIRE pull the question out of play and
 * close every open report about it (they are about the same defect); DISMISS and MARK_FIXED close
 * only this one.
 */
export async function resolveReport(
  db: Database,
  reportId: string,
  request: { actor: Actor; action: ReportAction; note?: string },
): Promise<ResolveResult> {
  if (!request.actor.roles.some((role) => (MODERATION_ROLES as readonly string[]).includes(role)))
    throw new LifecycleError('FORBIDDEN');
  const note = request.note ? cleanText(request.note).slice(0, 300) : null;
  return db.transaction().execute(async (trx) => {
    const report = await trx
      .selectFrom('question_reports')
      .select(['id', 'question_id', 'status'])
      .where('id', '=', reportId)
      .forUpdate()
      .executeTakeFirst();
    if (!report) throw new LifecycleError('NOT_FOUND');
    if (report.status !== 'OPEN')
      throw new LifecycleError('INVALID_TRANSITION', { status: report.status });
    const resolution = {
      resolved_at: new Date(),
      resolved_by: request.actor.accountId,
      resolution: note,
    };
    let resolved = 1;
    if (request.action === 'DISMISS' || request.action === 'MARK_FIXED') {
      await trx
        .updateTable('question_reports')
        .set({ ...resolution, status: request.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED' })
        .where('id', '=', reportId)
        .execute();
    } else {
      const result = await trx
        .updateTable('question_reports')
        .set({ ...resolution, status: 'ACTIONED' })
        .where('question_id', '=', report.question_id)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();
      resolved = Number(result.numUpdatedRows);
      const to = request.action === 'RETIRE' ? 'RETIRED' : 'REVIEW';
      const current = await trx
        .selectFrom('questions')
        .select('status')
        .where('id', '=', report.question_id)
        .executeTakeFirstOrThrow();
      const worthMoving =
        request.action === 'RETIRE'
          ? current.status !== 'RETIRED'
          : ['ACTIVE', 'APPROVED'].includes(current.status);
      if (worthMoving)
        await transitionTx(trx, report.question_id, to, {
          actor: request.actor,
          reason: `REPORT_${request.action}`,
          detail: { report: reportId },
          ...(note ? { note } : {}),
        });
    }
    const after = await trx
      .selectFrom('questions')
      .select('status')
      .where('id', '=', report.question_id)
      .executeTakeFirstOrThrow();
    return { resolved, questionStatus: after.status };
  });
}
