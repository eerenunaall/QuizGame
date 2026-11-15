import { createHash } from 'node:crypto';
import type { Database } from '@quizparty/db';
import {
  AUTHORING_LIMITS,
  DraftPayload,
  TEXT_IMPORT_LIMITS,
  analyzeVenueUpload,
  importVenueUpload,
  parseQuestionText,
  type DraftEdit,
  type SkipReason,
} from '@quizparty/question-bank';
import type { VenueIssue } from '@quizparty/question-schema';
import type { Clock } from '../util/clock';
import { AuthoringError, draftRow, jsonl } from './authoring-service';

export interface DraftView {
  id: string;
  fileName: string;
  createdAt: number;
  expiresAt: number;
  payload: DraftPayload;
}

export interface ApproveResult {
  approved: number;
  /** Drafts that stayed drafts, with the reasons in the codes the page already translates. */
  problems: { id: string; issues: VenueIssue[] }[];
}

const APPROVE_AT_ONCE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The review list shows this many drafts (see `list`); more would be invisible to the owner. */
const LIST_CAP = 200;

export interface TextImportResult {
  drafts: number;
  /** Blocks that did not become drafts: the parser's reasons, plus `check` for the venue import checks. */
  skipped: {
    reason: SkipReason | 'check';
    number: number | null;
    excerpt: string;
    /** For `check`: the issue codes the page already translates. */
    codes?: string[];
  }[];
  keyUsed: boolean;
}

/**
 * The review gate (ADR-0028 §6): drafts are rows of their own, never questions. Only `approve` moves a
 * draft into the venue pool, and it does so through `importVenueUpload`, the pipeline every manual and
 * uploaded question uses (validation, player-text gate, heuristics, duplicates, the venue's cap).
 * Every query is scoped by venue: a draft id of another venue is simply not found.
 */
export class VenueDrafts {
  constructor(private readonly deps: { db: Database; clock: Clock }) {}

  private now(): Date {
    return new Date(this.deps.clock.now());
  }

  private view(row: {
    id: string;
    source_file_name: string;
    created_at: Date;
    expires_at: Date;
    payload: unknown;
  }): DraftView | null {
    const payload = DraftPayload.safeParse(row.payload);
    // A row that no longer fits the schema is never shown or approved.
    if (!payload.success) return null;
    return {
      id: row.id,
      fileName: row.source_file_name,
      createdAt: row.created_at.getTime(),
      expiresAt: row.expires_at.getTime(),
      payload: payload.data,
    };
  }

  /**
   * Questions that already exist as text become drafts without any model (owner decision 2026-11-10): the
   * parser reads them, the same checks as an approval run now so nothing is shown that could never be
   * published, and the rest waits for the owner's review like every other draft. Needs no `AUTHORING_*` key.
   */
  async importText(input: {
    venueId: string;
    accountId: string;
    fileName: string;
    text: string;
    category: string;
    difficulty: DraftPayload['difficulty'];
  }): Promise<TextImportResult> {
    const fileHash = createHash('sha256').update(input.text).digest('hex');
    const existing = await this.deps.db
      .selectFrom('venue_question_drafts')
      .select(['source_file_hash'])
      .where('venue_id', '=', input.venueId)
      .where('state', '=', 'DRAFT')
      .where('expires_at', '>', this.now())
      .execute();
    if (existing.some((row) => row.source_file_hash === fileHash))
      throw new AuthoringError('SAME_FILE');

    const parsed = parseQuestionText(input.text);
    const skipped: TextImportResult['skipped'] = [...parsed.skipped];
    const room = Math.max(0, LIST_CAP - existing.length);
    let candidates = parsed.questions;
    if (candidates.length > room) {
      for (const dropped of candidates.slice(room))
        skipped.push({
          reason: 'over_cap',
          number: dropped.number,
          excerpt: dropped.question.slice(0, TEXT_IMPORT_LIMITS.excerpt),
        });
      candidates = candidates.slice(0, room);
    }
    const payloads: DraftPayload[] = candidates.map((q) => ({
      category: input.category,
      difficulty: input.difficulty,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceQuote: '',
      page: '',
    }));

    let kept = candidates.map((_, i) => i);
    if (payloads.length > 0) {
      const dry = await analyzeVenueUpload(
        this.deps.db,
        {
          venueId: input.venueId,
          fileName: 'taslak',
          bytes: jsonl(payloads.map((payload) => draftRow(payload, 'AI_ASSISTED'))),
        },
        { now: this.now() },
      );
      if ('ok' in dry && dry.ok === false) {
        for (const q of candidates)
          skipped.push({
            reason: 'check',
            number: q.number,
            excerpt: q.question.slice(0, TEXT_IMPORT_LIMITS.excerpt),
            codes: [dry.issue.code],
          });
        kept = [];
      } else if ('rows' in dry) {
        // The very same rows are a live upload already (the owner re-sent questions that are in the pool):
        // the dry-run then lists no rows at all, so every one of them is a duplicate.
        const bad = dry.alreadyImported
          ? new Map(candidates.map((_, i) => [i + 1, ['duplicate']]))
          : new Map(dry.rows.map((row) => [row.line, row.issues.map((x) => x.code)]));
        kept = kept.filter((i) => !bad.has(i + 1));
        for (const [line, codes] of bad) {
          const q = candidates[line - 1];
          if (q)
            skipped.push({
              reason: 'check',
              number: q.number,
              excerpt: q.question.slice(0, TEXT_IMPORT_LIMITS.excerpt),
              codes,
            });
        }
      }
    }
    if (kept.length > 0) {
      const created = this.now();
      const expires = new Date(created.getTime() + AUTHORING_LIMITS.draftDays * DAY_MS);
      await this.deps.db
        .insertInto('venue_question_drafts')
        .values(
          kept.map((i, order) => ({
            venue_id: input.venueId,
            run_id: null,
            created_by: input.accountId,
            // One millisecond apart: the review list is ordered by creation time, so it keeps the
            // order of the document instead of a random one.
            created_at: new Date(created.getTime() + order),
            expires_at: expires,
            source_file_hash: fileHash,
            source_file_name: input.fileName.slice(0, 120),
            origin: 'TEXT' as const,
            payload: JSON.stringify(payloads[i]),
          })),
        )
        .execute();
    }
    return { drafts: kept.length, skipped, keyUsed: parsed.keyUsed };
  }

  async list(venueId: string): Promise<DraftView[]> {
    const rows = await this.deps.db
      .selectFrom('venue_question_drafts')
      .select(['id', 'source_file_name', 'created_at', 'expires_at', 'payload'])
      .where('venue_id', '=', venueId)
      .where('state', '=', 'DRAFT')
      .where('expires_at', '>', this.now())
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(200)
      .execute();
    return rows.flatMap((row) => this.view(row) ?? []);
  }

  /** The edit is stored whatever the checks say; the answer lists what would stop an approval. */
  async update(
    venueId: string,
    draftId: string,
    edit: DraftEdit,
  ): Promise<{ draft: DraftView; issues: VenueIssue[] } | null> {
    const row = await this.deps.db
      .selectFrom('venue_question_drafts')
      .select(['id', 'payload'])
      .where('id', '=', draftId)
      .where('venue_id', '=', venueId)
      .where('state', '=', 'DRAFT')
      .where('expires_at', '>', this.now())
      .executeTakeFirst();
    const current = row ? DraftPayload.safeParse(row.payload) : null;
    if (!row || !current?.success) return null;
    const payload: DraftPayload = { ...current.data, ...edit };
    const updated = await this.deps.db
      .updateTable('venue_question_drafts')
      .set({ payload: JSON.stringify(payload) })
      .where('id', '=', draftId)
      .where('venue_id', '=', venueId)
      .where('state', '=', 'DRAFT')
      .returning(['id', 'source_file_name', 'created_at', 'expires_at', 'payload'])
      .executeTakeFirst();
    const draft = updated ? this.view(updated) : null;
    if (!draft) return null;
    const analysis = await analyzeVenueUpload(
      this.deps.db,
      { venueId, fileName: 'taslak', bytes: jsonl([draftRow(payload)]) },
      { now: this.now() },
    );
    const issues =
      'ok' in analysis && analysis.ok === false
        ? [analysis.issue]
        : 'rows' in analysis
          ? analysis.rows.flatMap((report) => report.issues)
          : [];
    return { draft, issues };
  }

  async remove(venueId: string, draftId: string): Promise<boolean> {
    const result = await this.deps.db
      .deleteFrom('venue_question_drafts')
      .where('id', '=', draftId)
      .where('venue_id', '=', venueId)
      .where('state', '=', 'DRAFT')
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  /**
   * Approves the named drafts (or every live draft of the venue). One upload per source document, so
   * "Bu yüklemeyi kaldır" in the question list takes back exactly what one click published. Throws
   * `VenueContentError('VENUE_FULL')` when the venue's cap would be exceeded.
   */
  async approve(
    venueId: string,
    accountId: string,
    which: string[] | 'all',
  ): Promise<ApproveResult> {
    let query = this.deps.db
      .selectFrom('venue_question_drafts')
      .select(['id', 'source_file_hash', 'source_file_name', 'origin', 'payload'])
      .where('venue_id', '=', venueId)
      .where('state', '=', 'DRAFT')
      .where('expires_at', '>', this.now());
    if (which !== 'all')
      query = query.where(
        'id',
        'in',
        which.length > 0 ? which : ['00000000-0000-0000-0000-000000000000'],
      );
    const rows = await query
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(APPROVE_AT_ONCE)
      .execute();

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = groups.get(row.source_file_hash) ?? [];
      group.push(row);
      groups.set(row.source_file_hash, group);
    }
    const result: ApproveResult = { approved: 0, problems: [] };
    for (const [fileHash, group] of groups) {
      const parsed = group.map((row) => ({ row, payload: DraftPayload.safeParse(row.payload) }));
      const valid = parsed.flatMap((item) =>
        item.payload.success ? [{ row: item.row, payload: item.payload.data }] : [],
      );
      for (const item of parsed)
        if (!item.payload.success)
          result.problems.push({
            id: item.row.id,
            issues: [{ field: '', code: 'row_not_object' }],
          });
      if (valid.length === 0) continue;
      // Drafts of one file hash share an origin (the hash is of the same source text/document).
      const fromText = valid[0]!.row.origin === 'TEXT';
      const imported = await importVenueUpload(
        this.deps.db,
        {
          venueId,
          accountId,
          // Not ending in .csv/.txt: the format is sniffed from the content (JSON lines), not the name.
          fileName: fromText
            ? `Belge: ${valid[0]!.row.source_file_name.slice(0, 100)}`
            : `Belge: ${valid[0]!.row.source_file_name.slice(0, 100)} (AI)`,
          bytes: jsonl(
            valid.map((item) =>
              fromText ? draftRow(item.payload, 'AI_ASSISTED') : draftRow(item.payload),
            ),
          ),
          origin: fromText ? 'FILE' : 'AI',
          sourceFileHash: fileHash,
        },
        { now: this.now() },
      );
      if ('ok' in imported && imported.ok === false) {
        for (const item of valid)
          result.problems.push({ id: item.row.id, issues: [imported.issue] });
        continue;
      }
      if (!('created' in imported)) continue;
      const byLine = new Map(imported.created.map((made) => [made.line, made.questionId]));
      const reports = new Map(imported.analysis.rows.map((report) => [report.line, report.issues]));
      const when = this.now();
      for (const [i, item] of valid.entries()) {
        const questionId = byLine.get(i + 1);
        if (questionId === undefined) {
          result.problems.push({
            id: item.row.id,
            issues: reports.get(i + 1) ?? [{ field: '', code: 'duplicate' }],
          });
          continue;
        }
        await this.deps.db
          .updateTable('venue_question_drafts')
          .set({
            state: 'APPROVED',
            approved_at: when,
            approved_by: accountId,
            question_id: questionId,
            upload_id: imported.uploadId,
          })
          .where('id', '=', item.row.id)
          .where('state', '=', 'DRAFT')
          .execute();
        result.approved++;
      }
    }
    return result;
  }
}
