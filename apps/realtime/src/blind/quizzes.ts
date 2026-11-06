import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import { BLIND_CATALOG_KEYS, BLIND_LIMITS, type ErrorCode, type Locale } from '@quizparty/protocol';
import { sanitizeUserText } from '@quizparty/validation';
import type { Clock } from '../util/clock';
import { BlindVault, RETENTION_MS } from './vault';

export type Outcome<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; params?: Record<string, string | number> };

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = (code: ErrorCode, params?: Record<string, string | number>): Outcome<never> => ({
  ok: false,
  code,
  ...(params ? { params } : {}),
});

export type QuizKind = 'BLIND' | 'CUSTOM';

export interface QuizSummary {
  id: string;
  kind: QuizKind;
  title: string;
  language: Locale;
  createdAt: string;
  retainUntil: string;
  ready: boolean;
}

export type TargetStatus = 'PENDING' | 'ANSWERED' | 'APPROVED';

export interface QuizDetail extends QuizSummary {
  prompts: { id: string; position: number; catalogKey: string | null; text: string | null }[];
  /** Completion only: never a word of what anyone answered. */
  targets: {
    id: string;
    displayName: string;
    status: TargetStatus;
    answered: number;
    approved: number;
    total: number;
  }[];
  questions: {
    id: string;
    position: number;
    text: string;
    options: string[];
    correctIndex: number;
    explanation: string | null;
  }[];
}

/**
 * The creator's side of personal quizzes. By construction it can only count: it never selects the
 * sealed column of a response, so nothing it returns can contain what a target answered (ADR-0015).
 */
export class QuizService {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly vault: BlindVault;
  private readonly publicWebUrl: string;

  constructor(deps: { db: Database; clock: Clock; vault: BlindVault; publicWebUrl: string }) {
    this.db = deps.db;
    this.clock = deps.clock;
    this.vault = deps.vault;
    this.publicWebUrl = deps.publicWebUrl;
  }

  private inviteUrl(token: string): string {
    return `${this.publicWebUrl}/blind/respond/${token}`;
  }

  private async owned(accountId: string, quizId: string) {
    return this.db
      .selectFrom('personal_quizzes')
      .selectAll()
      .where('id', '=', quizId)
      .where('owner_account_id', '=', accountId)
      .executeTakeFirst();
  }

  /** How many questions could be played right now (counts rows; opens nothing). */
  private async playableCount(quizId: string, kind: QuizKind): Promise<number> {
    if (kind === 'CUSTOM') {
      const row = await this.db
        .selectFrom('custom_questions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('quiz_id', '=', quizId)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    }
    const row = await this.db
      .selectFrom('blind_responses')
      .innerJoin('blind_targets', 'blind_targets.id', 'blind_responses.target_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('blind_targets.quiz_id', '=', quizId)
      .where('blind_targets.consented_at', 'is not', null)
      .where('blind_responses.approved_at', 'is not', null)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async list(accountId: string): Promise<QuizSummary[]> {
    const rows = await this.db
      .selectFrom('personal_quizzes')
      .selectAll()
      .where('owner_account_id', '=', accountId)
      .orderBy('created_at', 'desc')
      .execute();
    const out: QuizSummary[] = [];
    for (const row of rows) out.push(await this.summary(row));
    return out;
  }

  private async summary(row: {
    id: string;
    kind: string;
    title: string;
    language: string;
    created_at: Date;
    retain_until: Date;
  }): Promise<QuizSummary> {
    const kind = row.kind as QuizKind;
    return {
      id: row.id,
      kind,
      title: row.title,
      language: row.language as Locale,
      createdAt: row.created_at.toISOString(),
      retainUntil: row.retain_until.toISOString(),
      ready: (await this.playableCount(row.id, kind)) >= BLIND_LIMITS.playableMin,
    };
  }

  async create(
    accountId: string,
    input: { kind: QuizKind; title: unknown; language: Locale },
  ): Promise<Outcome<QuizSummary>> {
    const title = sanitizeUserText(input.title, { maxLength: 60 });
    if (!title.ok) return fail('TEXT_REJECTED', { reason: title.reason });
    const count = await this.db
      .selectFrom('personal_quizzes')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('owner_account_id', '=', accountId)
      .executeTakeFirstOrThrow();
    if (Number(count.n) >= BLIND_LIMITS.quizzesPerAccount) return fail('LIMIT_REACHED');
    const row = await this.db
      .insertInto('personal_quizzes')
      .values({
        owner_account_id: accountId,
        kind: input.kind,
        title: title.text,
        language: input.language,
        retain_until: new Date(this.clock.now() + RETENTION_MS),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return ok(await this.summary(row));
  }

  async remove(accountId: string, quizId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('personal_quizzes')
      .where('id', '=', quizId)
      .where('owner_account_id', '=', accountId)
      .returning('id')
      .executeTakeFirst();
    return result !== undefined;
  }

  async get(accountId: string, quizId: string): Promise<QuizDetail | null> {
    const quiz = await this.owned(accountId, quizId);
    if (!quiz) return null;
    const [prompts, targets, questions] = await Promise.all([
      this.db
        .selectFrom('blind_prompts')
        .select(['id', 'position', 'catalog_key', 'text'])
        .where('quiz_id', '=', quizId)
        .orderBy('position')
        .execute(),
      this.db
        .selectFrom('blind_targets')
        .leftJoin('blind_responses', 'blind_responses.target_id', 'blind_targets.id')
        .select([
          'blind_targets.id as id',
          'blind_targets.display_name as display_name',
          'blind_targets.consented_at as consented_at',
          'blind_targets.created_at as created_at',
          sql<number>`count(blind_responses.id)::int`.as('answered'),
          sql<number>`count(blind_responses.approved_at)::int`.as('approved'),
        ])
        .where('blind_targets.quiz_id', '=', quizId)
        .groupBy('blind_targets.id')
        .orderBy('blind_targets.created_at')
        .execute(),
      this.db
        .selectFrom('custom_questions')
        .select(['id', 'position', 'text', 'options', 'correct_index', 'explanation'])
        .where('quiz_id', '=', quizId)
        .orderBy('position')
        .execute(),
    ]);
    const total = prompts.length;
    return {
      ...(await this.summary(quiz)),
      prompts: prompts.map((p) => ({
        id: p.id,
        position: p.position,
        catalogKey: p.catalog_key,
        text: p.text,
      })),
      targets: targets.map((t) => ({
        id: t.id,
        displayName: t.display_name,
        answered: t.answered,
        approved: t.approved,
        total,
        status:
          t.approved >= total && total > 0
            ? 'APPROVED'
            : t.consented_at && t.answered > 0
              ? 'ANSWERED'
              : 'PENDING',
      })),
      questions: questions.map((q) => ({
        id: q.id,
        position: q.position,
        text: q.text,
        options: q.options as string[],
        correctIndex: q.correct_index,
        explanation: q.explanation,
      })),
    };
  }

  async addPrompt(
    accountId: string,
    quizId: string,
    input: { catalogKey?: string; text?: unknown },
  ): Promise<Outcome<{ id: string }> | 'NOT_FOUND'> {
    const quiz = await this.owned(accountId, quizId);
    if (!quiz || quiz.kind !== 'BLIND') return 'NOT_FOUND';
    let values: { source: 'CATALOG' | 'CUSTOM'; catalog_key: string | null; text: string | null };
    if (input.catalogKey !== undefined) {
      if (!(BLIND_CATALOG_KEYS as readonly string[]).includes(input.catalogKey))
        return fail('INVALID_MESSAGE');
      values = { source: 'CATALOG', catalog_key: input.catalogKey, text: null };
    } else {
      const text = sanitizeUserText(input.text, { maxLength: 140 });
      if (!text.ok) return fail('TEXT_REJECTED', { reason: text.reason });
      if (text.text.length < 3) return fail('TEXT_REJECTED', { reason: 'EMPTY' });
      values = { source: 'CUSTOM', catalog_key: null, text: text.text };
    }
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('personal_quizzes')
        .select('id')
        .where('id', '=', quizId)
        .forUpdate()
        .execute();
      const taken = await trx
        .selectFrom('blind_prompts')
        .select(['position', 'catalog_key'])
        .where('quiz_id', '=', quizId)
        .execute();
      if (taken.length >= BLIND_LIMITS.promptsMax) return fail('LIMIT_REACHED');
      if (values.catalog_key && taken.some((t) => t.catalog_key === values.catalog_key))
        return fail('INVALID_MESSAGE');
      const used = new Set(taken.map((t) => t.position));
      let position = 0;
      while (used.has(position)) position += 1;
      const row = await trx
        .insertInto('blind_prompts')
        .values({ quiz_id: quizId, position, ...values })
        .returning('id')
        .executeTakeFirstOrThrow();
      return ok({ id: row.id });
    });
  }

  async removePrompt(accountId: string, quizId: string, promptId: string): Promise<boolean> {
    if (!(await this.owned(accountId, quizId))) return false;
    const result = await this.db
      .deleteFrom('blind_prompts')
      .where('id', '=', promptId)
      .where('quiz_id', '=', quizId)
      .returning('id')
      .executeTakeFirst();
    return result !== undefined;
  }

  async addTarget(
    accountId: string,
    quizId: string,
    displayName: unknown,
  ): Promise<Outcome<{ id: string; inviteUrl: string }> | 'NOT_FOUND'> {
    const quiz = await this.owned(accountId, quizId);
    if (!quiz || quiz.kind !== 'BLIND') return 'NOT_FOUND';
    const name = sanitizeUserText(displayName, { maxLength: 30 });
    if (!name.ok) return fail('TEXT_REJECTED', { reason: name.reason });
    const count = await this.db
      .selectFrom('blind_targets')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('quiz_id', '=', quizId)
      .executeTakeFirstOrThrow();
    if (Number(count.n) >= BLIND_LIMITS.targetsMax) return fail('LIMIT_REACHED');
    const token = BlindVault.newToken();
    const row = await this.db
      .insertInto('blind_targets')
      .values({
        quiz_id: quizId,
        display_name: name.text,
        invite_hash: this.vault.inviteHash(token),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return ok({ id: row.id, inviteUrl: this.inviteUrl(token) });
  }

  /** A new invite link for a target (the old one stops working at once). */
  async rotateInvite(
    accountId: string,
    quizId: string,
    targetId: string,
  ): Promise<{ inviteUrl: string } | 'CLAIMED' | null> {
    if (!(await this.owned(accountId, quizId))) return null;
    const token = BlindVault.newToken();
    // Never after the target took the invite: a fresh link in the creator's hands is exactly what
    // the claim secret exists to make useless (ATTACK 10), and the old one is the target's way in.
    const row = await this.db
      .updateTable('blind_targets')
      .set({ invite_hash: this.vault.inviteHash(token) })
      .where('id', '=', targetId)
      .where('quiz_id', '=', quizId)
      .where('claim_hash', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (row) return { inviteUrl: this.inviteUrl(token) };
    const exists = await this.db
      .selectFrom('blind_targets')
      .select('id')
      .where('id', '=', targetId)
      .where('quiz_id', '=', quizId)
      .executeTakeFirst();
    return exists ? 'CLAIMED' : null;
  }

  async removeTarget(accountId: string, quizId: string, targetId: string): Promise<boolean> {
    if (!(await this.owned(accountId, quizId))) return false;
    const row = await this.db
      .deleteFrom('blind_targets')
      .where('id', '=', targetId)
      .where('quiz_id', '=', quizId)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async addQuestion(
    accountId: string,
    quizId: string,
    input: { text: unknown; options: unknown; correctIndex: unknown; explanation?: unknown },
  ): Promise<Outcome<{ id: string }> | 'NOT_FOUND'> {
    const quiz = await this.owned(accountId, quizId);
    if (!quiz || quiz.kind !== 'CUSTOM') return 'NOT_FOUND';
    const text = sanitizeUserText(input.text, { maxLength: 200 });
    if (!text.ok || text.text.length < 5)
      return fail('TEXT_REJECTED', { reason: text.ok ? 'EMPTY' : text.reason });
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4)
      return fail('INVALID_MESSAGE');
    const options: string[] = [];
    for (const raw of input.options as unknown[]) {
      const option = sanitizeUserText(raw, { maxLength: 80 });
      if (!option.ok) return fail('TEXT_REJECTED', { reason: option.reason });
      options.push(option.text);
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
      return fail('TEXT_REJECTED', { reason: 'DUPLICATE' });
    if (
      typeof input.correctIndex !== 'number' ||
      !Number.isInteger(input.correctIndex) ||
      input.correctIndex < 0 ||
      input.correctIndex >= options.length
    )
      return fail('INVALID_MESSAGE');
    let explanation: string | null = null;
    if (input.explanation !== undefined && input.explanation !== null && input.explanation !== '') {
      const checked = sanitizeUserText(input.explanation, { maxLength: 200 });
      if (!checked.ok) return fail('TEXT_REJECTED', { reason: checked.reason });
      explanation = checked.text;
    }
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('personal_quizzes')
        .select('id')
        .where('id', '=', quizId)
        .forUpdate()
        .execute();
      const taken = await trx
        .selectFrom('custom_questions')
        .select('position')
        .where('quiz_id', '=', quizId)
        .execute();
      if (taken.length >= BLIND_LIMITS.customQuestionsMax) return fail('LIMIT_REACHED');
      const used = new Set(taken.map((t) => t.position));
      let position = 0;
      while (used.has(position)) position += 1;
      const row = await trx
        .insertInto('custom_questions')
        .values({
          quiz_id: quizId,
          position,
          text: text.text,
          options: JSON.stringify(options),
          correct_index: input.correctIndex as number,
          explanation,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('personal_quizzes')
        .set({
          updated_at: new Date(this.clock.now()),
          retain_until: new Date(this.clock.now() + RETENTION_MS),
        })
        .where('id', '=', quizId)
        .execute();
      return ok({ id: row.id });
    });
  }

  async removeQuestion(accountId: string, quizId: string, questionId: string): Promise<boolean> {
    if (!(await this.owned(accountId, quizId))) return false;
    const row = await this.db
      .deleteFrom('custom_questions')
      .where('id', '=', questionId)
      .where('quiz_id', '=', quizId)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Quiz facts a room needs to start using it: kind, title, language, and whether it is ready. */
  async forAttach(
    accountId: string,
    quizId: string,
  ): Promise<{
    kind: QuizKind;
    title: string;
    language: Locale;
    ready: boolean;
    questions: number;
  } | null> {
    const quiz = await this.owned(accountId, quizId);
    if (!quiz) return null;
    const kind = quiz.kind as QuizKind;
    const questions = await this.playableCount(quizId, kind);
    return {
      kind,
      title: quiz.title,
      language: quiz.language as Locale,
      ready: questions >= BLIND_LIMITS.playableMin,
      questions,
    };
  }

  /**
   * The owner's copy for an account export (ADR-0018 data-subject rights): exactly what the creator's
   * own API already shows (titles, prompts, target names, completion counts, custom questions) plus the
   * dates. What a target answered is theirs, not the creator's, and stays out (ADR-0015).
   */
  async exportForOwner(
    accountId: string,
  ): Promise<(QuizDetail & { updatedAt: string; lastUsedAt: string | null })[]> {
    const rows = await this.db
      .selectFrom('personal_quizzes')
      .select(['id', 'updated_at', 'last_used_at'])
      .where('owner_account_id', '=', accountId)
      .orderBy('created_at')
      .execute();
    const out: (QuizDetail & { updatedAt: string; lastUsedAt: string | null })[] = [];
    for (const row of rows) {
      const detail = await this.get(accountId, row.id);
      if (!detail) continue; // deleted meanwhile
      out.push({
        ...detail,
        updatedAt: row.updated_at.toISOString(),
        lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
      });
    }
    return out;
  }

  /** Retention (ADR-0015): quizzes past their retention date are deleted with everything under them. */
  async purgeExpired(): Promise<number> {
    const rows = await this.db
      .deleteFrom('personal_quizzes')
      .where('retain_until', '<', new Date(this.clock.now()))
      .returning('id')
      .execute();
    return rows.length;
  }
}
