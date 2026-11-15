import { sql } from 'kysely';
import type { Database } from '@quizparty/db';
import { SYSTEM_ACTOR, transitionTx } from './lifecycle';

/**
 * Continuous maintenance (docs/QUESTION_QUALITY.md §9, §12; GDD §10): the bank is a live system.
 * Telemetry, reports and the calendar can move an ACTIVE question back to REVIEW; nothing here ever
 * rewrites history (the status log records every move) or touches dev-seed content.
 */
export interface MaintenanceConfig {
  /** Answers needed before telemetry is trusted. */
  minAnswers: number;
  /** Correct rate below which a question looks broken (wrong key, or impossible). */
  lowCorrectRate: number;
  /** Correct rate above which it looks trivial or leaked. */
  highCorrectRate: number;
  /** One wrong option picked by this share of all answers is suspicious (a second right answer?). */
  dominantWrongShare: number;
  /** Evergreen questions not verified for this many days come back for a look. */
  evergreenReverifyDays: number;
}

export const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  minAnswers: 60,
  lowCorrectRate: 0.1,
  highCorrectRate: 0.98,
  dominantWrongShare: 0.6,
  evergreenReverifyDays: 540,
};

export interface TelemetrySample {
  answers: number;
  correct: number;
  /** Picks per option, with which one is the official answer. */
  options: { picks: number; correct: boolean }[];
}

export interface TelemetryVerdict {
  reason: 'LOW_CORRECT_RATE' | 'HIGH_CORRECT_RATE' | 'DOMINANT_WRONG_OPTION';
  detail: Record<string, number>;
}

/** Pure decision: does this question's answer history look healthy? (rubric §9) */
export function telemetryVerdict(
  sample: TelemetrySample,
  config: MaintenanceConfig = DEFAULT_MAINTENANCE,
): TelemetryVerdict | null {
  if (sample.answers < config.minAnswers) return null;
  const rate = sample.correct / sample.answers;
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  if (rate < config.lowCorrectRate)
    return { reason: 'LOW_CORRECT_RATE', detail: { rate: round(rate), answers: sample.answers } };
  if (rate > config.highCorrectRate)
    return { reason: 'HIGH_CORRECT_RATE', detail: { rate: round(rate), answers: sample.answers } };
  const topWrong = Math.max(
    0,
    ...sample.options.filter((option) => !option.correct).map((option) => option.picks),
  );
  const share = topWrong / sample.answers;
  if (share >= config.dominantWrongShare)
    return {
      reason: 'DOMINANT_WRONG_OPTION',
      detail: { share: round(share), answers: sample.answers },
    };
  return null;
}

export interface MaintenanceReport {
  expired: number;
  reverify: number;
  telemetry: number;
  ran: boolean;
}

const LOCK_KEY = 7_340_221;

/**
 * One maintenance pass, guarded by an advisory lock so that only one instance runs it at a time.
 * ACTIVE questions that expired, have gone stale, or whose answers look wrong go back to REVIEW.
 */
export async function runMaintenance(
  db: Database,
  options: { now: Date; config?: Partial<MaintenanceConfig> },
): Promise<MaintenanceReport> {
  const config = { ...DEFAULT_MAINTENANCE, ...options.config };
  return db.transaction().execute(async (trx) => {
    const lock = await sql<{
      locked: boolean;
    }>`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`.execute(trx);
    if (!lock.rows[0]?.locked) return { expired: 0, reverify: 0, telemetry: 0, ran: false };

    const move = async (
      ids: string[],
      reason: string,
      detail: (id: string) => Record<string, unknown>,
    ) => {
      for (const id of ids)
        await transitionTx(trx, id, 'REVIEW', { actor: SYSTEM_ACTOR, reason, detail: detail(id) });
      return ids.length;
    };

    const expired = await trx
      .selectFrom('questions')
      .select('id')
      .where('status', '=', 'ACTIVE')
      .where('is_dev_seed', '=', false)
      .where('expires_at', 'is not', null)
      .where('expires_at', '<=', options.now)
      .forUpdate()
      .execute();
    const expiredCount = await move(
      expired.map((row) => row.id),
      'EXPIRED',
      () => ({ at: options.now.toISOString() }),
    );

    const cutoff = new Date(options.now.getTime() - config.evergreenReverifyDays * 86_400_000);
    const stale = await trx
      .selectFrom('questions')
      .select('id')
      .where('status', '=', 'ACTIVE')
      .where('is_dev_seed', '=', false)
      .where('pool', '=', 'EVERGREEN')
      .where('last_verified_at', 'is not', null)
      .where('last_verified_at', '<', cutoff)
      .forUpdate()
      .execute();
    const reverify = await move(
      stale.map((row) => row.id),
      'REVERIFY_DUE',
      () => ({ days: config.evergreenReverifyDays }),
    );

    const candidates = await trx
      .selectFrom('questions')
      .select(['id', 'answer_count', 'correct_answer_count'])
      .where('status', '=', 'ACTIVE')
      .where('is_dev_seed', '=', false)
      .where('answer_count', '>=', config.minAnswers)
      .forUpdate()
      .execute();
    let telemetry = 0;
    for (const candidate of candidates) {
      const options_ = await trx
        .selectFrom('question_options')
        .select(['pick_count', 'is_correct'])
        .where('question_id', '=', candidate.id)
        .execute();
      const verdict = telemetryVerdict(
        {
          answers: candidate.answer_count,
          correct: candidate.correct_answer_count,
          options: options_.map((option) => ({
            picks: option.pick_count,
            correct: option.is_correct,
          })),
        },
        config,
      );
      if (!verdict) continue;
      await transitionTx(trx, candidate.id, 'REVIEW', {
        actor: SYSTEM_ACTOR,
        reason: 'TELEMETRY_ANOMALY',
        detail: { verdict: verdict.reason, ...verdict.detail },
      });
      telemetry++;
    }
    return { expired: expiredCount, reverify, telemetry, ran: true };
  });
}
