import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import type { QuestionReportReason } from '@quizparty/protocol';
import { pseudonym } from '../security/crypto';
import type { Clock } from '../util/clock';

export type PersonalReportKind = 'BLIND' | 'CUSTOM';
export type PersonalReportAction = 'DISMISS' | 'REMOVE_QUESTION' | 'DELETE_QUIZ';

export interface PersonalReportItem {
  id: string;
  quizId: string;
  kind: PersonalReportKind;
  questionId: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  /** Open reports against the same question (one per reporting player). */
  reports: number;
}

/**
 * Reports of personal-quiz questions (ADR-0015 "UGC safety"). A report carries ids only: the quiz, the
 * question and the reason. Moderators act on those ids (remove the question, delete the quiz, dismiss)
 * and are never shown a question, an option or an answer, so nothing sealed leaves the vault for them.
 * Who Said It statements are not reportable here: they live only in the room and are erased at close.
 */
export class PersonalReports {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  /**
   * Records a report for a question the room is actually playing from `quizId`. Returns false when the
   * question does not belong to that quiz (any more), so a client cannot aim a report anywhere else.
   */
  async submit(input: {
    quizId: string;
    kind: PersonalReportKind;
    questionId: string;
    sessionId: string;
    roomId: string;
    reason: QuestionReportReason;
  }): Promise<boolean> {
    if (!(await this.belongs(input.quizId, input.kind, input.questionId))) return false;
    await this.db
      .insertInto('personal_reports')
      .values({
        quiz_id: input.quizId,
        kind: input.kind,
        question_id: input.questionId,
        reporter_hash: pseudonym(this.secret, 'reporter', input.sessionId),
        room_id: input.roomId,
        reason: input.reason,
      })
      // a player reports a question once; a second press is not a second voice
      .onConflict((oc) => oc.columns(['question_id', 'reporter_hash']).doNothing())
      .execute();
    return true;
  }

  private async belongs(quizId: string, kind: PersonalReportKind, questionId: string) {
    const row =
      kind === 'CUSTOM'
        ? await this.db
            .selectFrom('custom_questions')
            .select('id')
            .where('id', '=', questionId)
            .where('quiz_id', '=', quizId)
            .executeTakeFirst()
        : // existence check by id only: the response row's content column is never selected here
          await this.db
            .selectFrom('blind_responses')
            .innerJoin('blind_targets', 'blind_targets.id', 'blind_responses.target_id')
            .select('blind_responses.id as id')
            .where('blind_responses.id', '=', questionId)
            .where('blind_targets.quiz_id', '=', quizId)
            .executeTakeFirst();
    return row !== undefined;
  }

  async list(query: {
    status: 'OPEN' | 'ACTIONED' | 'DISMISSED';
    limit: number;
    offset: number;
  }): Promise<{ total: number; items: PersonalReportItem[] }> {
    const total = await this.db
      .selectFrom('personal_reports')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('status', '=', query.status)
      .executeTakeFirstOrThrow();
    const rows = await this.db
      .selectFrom('personal_reports as r')
      .select([
        'r.id',
        'r.quiz_id',
        'r.kind',
        'r.question_id',
        'r.reason',
        'r.status',
        'r.created_at',
        'r.resolved_at',
        'r.resolution',
        sql<number>`(SELECT count(*)::int FROM personal_reports o
          WHERE o.question_id = r.question_id AND o.status = 'OPEN')`.as('open_count'),
      ])
      .where('r.status', '=', query.status)
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id')
      .limit(query.limit)
      .offset(query.offset)
      .execute();
    // The reporter's pseudonym and room stay on the server: moderators judge content, not people.
    return {
      total: Number(total.n),
      items: rows.map((row) => ({
        id: row.id,
        quizId: row.quiz_id,
        kind: row.kind as PersonalReportKind,
        questionId: row.question_id,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
        resolution: row.resolution,
        reports: row.open_count,
      })),
    };
  }

  /**
   * Resolves a report. REMOVE_QUESTION deletes the reported question (a blind response or a custom
   * question) without reading it; DELETE_QUIZ deletes the whole quiz, which also removes its reports.
   * Every other open report of the same question is closed with the same decision.
   */
  async resolve(
    id: string,
    action: PersonalReportAction,
    actor: string | null,
  ): Promise<{ ok: true; closed: number } | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATE' }> {
    return this.db.transaction().execute(async (trx) => {
      const report = await trx
        .selectFrom('personal_reports')
        .select(['id', 'quiz_id', 'kind', 'question_id', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!report) return { ok: false, code: 'NOT_FOUND' } as const;
      if (report.status !== 'OPEN') return { ok: false, code: 'INVALID_STATE' } as const;
      if (action === 'DELETE_QUIZ') {
        const gone = await trx
          .deleteFrom('personal_reports')
          .where('quiz_id', '=', report.quiz_id)
          .where('status', '=', 'OPEN')
          .executeTakeFirst();
        await trx.deleteFrom('personal_quizzes').where('id', '=', report.quiz_id).execute();
        return { ok: true, closed: Number(gone.numDeletedRows) } as const;
      }
      if (action === 'REMOVE_QUESTION') {
        if (report.kind === 'CUSTOM')
          await trx.deleteFrom('custom_questions').where('id', '=', report.question_id).execute();
        else await trx.deleteFrom('blind_responses').where('id', '=', report.question_id).execute();
      }
      const closed = await trx
        .updateTable('personal_reports')
        .set({
          status: action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED',
          resolved_at: new Date(this.clock.now()),
          resolved_by: actor,
          resolution: action,
        })
        .where('question_id', '=', report.question_id)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();
      return { ok: true, closed: Number(closed.numUpdatedRows) } as const;
    });
  }
}
