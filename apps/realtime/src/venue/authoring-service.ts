import type { Database } from '@quizparty/db';
import {
  AUTHORING_LIMITS,
  AUTHORING_SYSTEM,
  AnthropicClient,
  LlmError,
  QUESTION_TOOL,
  QuoteIndex,
  acceptModelQuestions,
  analyzeVenueUpload,
  authoringUserMessage,
  chunkSections,
  emptyDiscards,
  hashBytes,
  wantedPerChunk,
  type DiscardReason,
  type DraftPayload,
} from '@quizparty/question-bank';
import { cleanText } from '@quizparty/question-schema';
import { CircuitBreaker } from '../blind/decoys';
import type { AppConfig } from '../config';
import type { Clock } from '../util/clock';
import { extractDocument, type DocumentSection, type ExtractErrorCode } from './extract';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A run that has been RUNNING this long lost its process (restart, crash); the sweep fails it. */
const STALE_RUN_MS = 15 * 60 * 1000;

export type AuthoringErrorCode =
  'DISABLED' | 'QUOTA' | 'RUNNING' | 'SAME_FILE' | 'EXTRACT' | 'NOT_FOUND';

export class AuthoringError extends Error {
  constructor(
    readonly code: AuthoringErrorCode,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export type RunFailure = 'unavailable' | 'rejected_key' | 'bad_output' | 'interrupted';

export interface RunView {
  id: string;
  status: 'RUNNING' | 'OK' | 'EMPTY' | 'FAILED';
  failure: RunFailure | null;
  fileName: string;
  startedAt: number;
  finishedAt: number | null;
  drafts: number;
  discarded: number;
}

export interface QuotaView {
  limit: number;
  used: number;
  /** When the oldest counted run leaves the window, if the quota is used up. */
  resetAt: number | null;
}

export interface AuthoringLog {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
}

export interface AuthoringDeps {
  db: Database;
  settings: NonNullable<AppConfig['authoring']> | null;
  clock: Clock;
  log: AuthoringLog;
  /** Tests inject the shuffle; production uses Math.random. */
  random?: () => number;
}

/** One JSONL row the venue import pipeline understands, for a draft (also used by the review gate). */
export function draftRow(
  payload: Omit<DraftPayload, 'sourceQuote' | 'page'>,
): Record<string, unknown> {
  return {
    language: 'tr',
    category: payload.category,
    difficulty: payload.difficulty,
    question: payload.question,
    options: payload.options,
    correctIndex: payload.correctIndex,
    explanation: payload.explanation,
    authorType: 'AI_DRAFT',
  };
}

export const jsonl = (rows: Record<string, unknown>[]): Uint8Array =>
  new TextEncoder().encode(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

/**
 * Turns a document into question drafts (ADR-0028 §6): extract in a worker, check the quotas, then run
 * the model calls in the background while the page polls `getRun`. Nothing here stores the document or
 * the model's reply; only the drafts that survive the strict parser and the quote check are written.
 */
export class AuthoringService {
  private readonly breaker: CircuitBreaker;
  private readonly client: AnthropicClient | null;
  private readonly jobs = new Set<Promise<void>>();
  private readonly random: () => number;

  constructor(private readonly deps: AuthoringDeps) {
    this.breaker = new CircuitBreaker(deps.clock);
    this.random = deps.random ?? Math.random;
    const settings = deps.settings;
    // One retry for a transient 429/5xx: a second try is cheap, a third is a cost.
    this.client = settings
      ? new AnthropicClient({
          apiKey: settings.apiKey,
          ...(settings.apiBase ? { baseUrl: settings.apiBase } : {}),
          timeoutMs: settings.timeoutMs,
          maxRetries: 1,
        })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Resolves when every running job has finished (tests and graceful shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.jobs]);
  }

  private now(): Date {
    return new Date(this.deps.clock.now());
  }

  async quota(venueId: string): Promise<QuotaView> {
    const settings = this.deps.settings;
    const venue = await this.deps.db
      .selectFrom('venues')
      .select('authoring_daily_runs')
      .where('id', '=', venueId)
      .executeTakeFirst();
    const limit = venue?.authoring_daily_runs ?? settings?.dailyRuns ?? 0;
    const since = new Date(this.deps.clock.now() - DAY_MS);
    const rows = await this.deps.db
      .selectFrom('venue_authoring_runs')
      .select('at')
      .where('venue_id', '=', venueId)
      .where('at', '>', since)
      .where('status', 'in', ['RUNNING', 'OK', 'EMPTY'])
      .orderBy('at', 'asc')
      .execute();
    const resetAt = rows.length >= limit && rows[0] ? rows[0].at.getTime() + DAY_MS : null;
    return { limit, used: rows.length, resetAt };
  }

  /**
   * Reads the file, claims one run of the venue's daily quota and starts the model calls in the
   * background. Returns the run to poll. A file that cannot be read costs no quota.
   */
  async start(input: {
    venueId: string;
    accountId: string;
    fileName: string;
    bytes: Uint8Array;
    category: string;
  }): Promise<{ runId: string }> {
    const settings = this.deps.settings;
    if (!settings || !this.client) throw new AuthoringError('DISABLED');
    const fileName = cleanText(input.fileName).slice(0, 120) || 'belge';
    const extracted = await extractDocument(input.bytes, fileName);
    if (!extracted.ok)
      throw new AuthoringError('EXTRACT', { code: extracted.code satisfies ExtractErrorCode });
    const fileHash = hashBytes(input.bytes);
    const now = this.now();

    const runId = await this.deps.db.transaction().execute(async (trx) => {
      // One claim at a time per venue: the quota and the "one run at once" rule are checked under this lock.
      const venue = await trx
        .selectFrom('venues')
        .select('authoring_daily_runs')
        .where('id', '=', input.venueId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const limit = venue.authoring_daily_runs ?? settings.dailyRuns;
      const since = new Date(now.getTime() - DAY_MS);
      const counted = await trx
        .selectFrom('venue_authoring_runs')
        .select(['at', 'status'])
        .where('venue_id', '=', input.venueId)
        .where('at', '>', since)
        .where('status', 'in', ['RUNNING', 'OK', 'EMPTY'])
        .orderBy('at', 'asc')
        .execute();
      if (counted.some((run) => run.status === 'RUNNING')) throw new AuthoringError('RUNNING');
      if (counted.length >= limit)
        throw new AuthoringError('QUOTA', {
          limit,
          resetAt: counted[0] ? counted[0].at.getTime() + DAY_MS : null,
        });
      const everyone = await trx
        .selectFrom('venue_authoring_runs')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('at', '>', since)
        .where('status', 'in', ['RUNNING', 'OK', 'EMPTY'])
        .executeTakeFirstOrThrow();
      // The deployment-wide cost guard: busy is not the owner's fault and is not counted against them.
      if (Number(everyone.n) >= settings.globalDailyRuns)
        throw new AuthoringError('QUOTA', { global: true });
      const same = await trx
        .selectFrom('venue_question_drafts')
        .select('id')
        .where('venue_id', '=', input.venueId)
        .where('source_file_hash', '=', fileHash)
        .where('state', '=', 'DRAFT')
        .where('expires_at', '>', now)
        .limit(1)
        .executeTakeFirst();
      if (same) throw new AuthoringError('SAME_FILE');
      const run = await trx
        .insertInto('venue_authoring_runs')
        .values({
          venue_id: input.venueId,
          account_id: input.accountId,
          at: now,
          source_file_hash: fileHash,
          source_file_name: fileName,
          input_chars: extracted.chars,
          status: 'RUNNING',
          category: input.category,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return run.id;
    });

    const job = this.execute({
      runId,
      venueId: input.venueId,
      accountId: input.accountId,
      category: input.category,
      fileHash,
      fileName,
      sections: extracted.sections,
    }).catch((error: unknown) => {
      this.deps.log.warn(
        { runId, err: error instanceof Error ? error.name : 'error' },
        'authoring run crashed',
      );
      return this.finish(runId, { status: 'FAILED', failure: 'interrupted' });
    });
    const tracked = job.finally(() => this.jobs.delete(tracked));
    this.jobs.add(tracked);
    return { runId };
  }

  private async finish(
    runId: string,
    result: {
      status: 'OK' | 'EMPTY' | 'FAILED';
      failure?: RunFailure | null;
      drafts?: number;
      discarded?: number;
      inputTokens?: number;
      outputTokens?: number;
    },
  ): Promise<void> {
    await this.deps.db
      .updateTable('venue_authoring_runs')
      .set({
        status: result.status,
        failure: result.failure ?? null,
        drafts: result.drafts ?? 0,
        discarded: result.discarded ?? 0,
        input_tokens: result.inputTokens ?? 0,
        output_tokens: result.outputTokens ?? 0,
        finished_at: this.now(),
      })
      .where('id', '=', runId)
      .where('status', '=', 'RUNNING')
      .execute();
  }

  private async execute(run: {
    runId: string;
    venueId: string;
    accountId: string;
    category: string;
    fileHash: string;
    fileName: string;
    sections: DocumentSection[];
  }): Promise<void> {
    const settings = this.deps.settings!;
    const client = this.client!;
    const chunks = chunkSections(run.sections);
    const index = new QuoteIndex(chunks.flatMap((chunk) => chunk.sections));
    const state = { seen: new Set<string>(), kept: 0 };
    const drafts: Omit<DraftPayload, 'category'>[] = [];
    const discards = emptyDiscards();
    let inputTokens = 0;
    let outputTokens = 0;
    let failure: RunFailure | null = null;
    let usable = 0;

    for (const chunk of chunks) {
      if (state.kept >= AUTHORING_LIMITS.maxDrafts) break;
      if (!this.breaker.allow()) {
        failure ??= 'unavailable';
        break;
      }
      let toolInput: unknown;
      try {
        const completion = await client.complete({
          model: settings.model,
          system: AUTHORING_SYSTEM,
          user: authoringUserMessage(chunk.sections, wantedPerChunk(chunks.length)),
          maxTokens: AUTHORING_LIMITS.maxOutputTokens,
          tool: QUESTION_TOOL,
        });
        inputTokens += completion.inputTokens;
        outputTokens += completion.outputTokens;
        toolInput = completion.toolInput;
        this.breaker.success();
      } catch (error) {
        const status = error instanceof LlmError ? error.status : null;
        const keyProblem = status === 401 || status === 403;
        // A refused key is our configuration, not an outage: it must not hide a recovery for others.
        if (!keyProblem) this.breaker.failure();
        failure ??= keyProblem ? 'rejected_key' : 'unavailable';
        if (failure === 'rejected_key') break;
        continue;
      }
      const accepted = acceptModelQuestions(toolInput, index, state, this.random);
      if (!accepted) {
        // A reply that is not our schema is not an outage: it does not trip the breaker.
        discards.schema++;
        failure ??= 'bad_output';
        continue;
      }
      usable++;
      for (const key of Object.keys(accepted.discarded) as DiscardReason[])
        discards[key] += accepted.discarded[key];
      for (const draft of accepted.drafts) {
        state.kept++;
        drafts.push(draft);
      }
    }
    // A chunk that failed while others worked is a partial result, not a failed run.
    if (drafts.length > 0 || usable > 0) failure = null;

    // The same checks as an approval, now, so the owner is not shown what could never be published.
    let kept = drafts;
    let blocked = 0;
    if (drafts.length > 0) {
      const dry = await analyzeVenueUpload(
        this.deps.db,
        {
          venueId: run.venueId,
          fileName: 'taslak',
          bytes: jsonl(drafts.map((draft) => draftRow({ ...draft, category: run.category }))),
        },
        { now: this.now() },
      );
      if ('ok' in dry && dry.ok === false) kept = [];
      else if ('rows' in dry) {
        const bad = new Set(dry.rows.map((row) => row.line));
        kept = drafts.filter((_, i) => !bad.has(i + 1));
      }
      blocked = drafts.length - kept.length;
    }
    const discardedTotal = Object.values(discards).reduce((sum, n) => sum + n, 0) + blocked;

    if (kept.length > 0) {
      const created = this.now();
      const expires = new Date(created.getTime() + AUTHORING_LIMITS.draftDays * DAY_MS);
      await this.deps.db
        .insertInto('venue_question_drafts')
        .values(
          kept.map((draft) => ({
            venue_id: run.venueId,
            run_id: run.runId,
            created_by: run.accountId,
            created_at: created,
            expires_at: expires,
            source_file_hash: run.fileHash,
            source_file_name: run.fileName,
            payload: JSON.stringify({ ...draft, category: run.category }),
          })),
        )
        .execute();
    }
    await this.finish(run.runId, {
      status: kept.length > 0 ? 'OK' : failure ? 'FAILED' : 'EMPTY',
      failure: kept.length > 0 ? null : failure,
      drafts: kept.length,
      discarded: discardedTotal,
      inputTokens,
      outputTokens,
    });
    // Counts and codes only: neither the document nor the model's reply is ever logged.
    this.deps.log.info(
      {
        runId: run.runId,
        venueId: run.venueId,
        chunks: chunks.length,
        drafts: kept.length,
        discarded: discardedTotal,
        failure,
        inputTokens,
        outputTokens,
      },
      'authoring run finished',
    );
  }

  async getRun(venueId: string, runId: string): Promise<RunView> {
    const row = await this.deps.db
      .selectFrom('venue_authoring_runs')
      .selectAll()
      .where('id', '=', runId)
      .where('venue_id', '=', venueId)
      .executeTakeFirst();
    if (!row) throw new AuthoringError('NOT_FOUND');
    return {
      id: row.id,
      status: row.status as RunView['status'],
      failure: row.failure as RunFailure | null,
      fileName: row.source_file_name,
      startedAt: row.at.getTime(),
      finishedAt: row.finished_at?.getTime() ?? null,
      drafts: row.drafts,
      discarded: row.discarded,
    };
  }

  /**
   * The maintenance sweep: drafts past their seven days are deleted, and a run whose process is gone is
   * failed so that it stops counting as "running" for its venue.
   */
  async sweep(): Promise<{ expired: number; interrupted: number }> {
    const now = this.now();
    const expired = await this.deps.db
      .deleteFrom('venue_question_drafts')
      .where('state', '=', 'DRAFT')
      .where('expires_at', '<=', now)
      .executeTakeFirst();
    const stale = await this.deps.db
      .updateTable('venue_authoring_runs')
      .set({ status: 'FAILED', failure: 'interrupted', finished_at: now })
      .where('status', '=', 'RUNNING')
      .where('at', '<', new Date(now.getTime() - STALE_RUN_MS))
      .executeTakeFirst();
    return {
      expired: Number(expired.numDeletedRows),
      interrupted: Number(stale.numUpdatedRows),
    };
  }
}
