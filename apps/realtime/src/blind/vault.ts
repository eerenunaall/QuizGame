import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Database } from '@quizparty/db';
import type { DeckQuestion } from '@quizparty/game-engine';
import { translate, type Locale } from '@quizparty/i18n';
import { BLIND_LIMITS, type ErrorCode } from '@quizparty/protocol';
import { sanitizeUserText } from '@quizparty/validation';
import { foldCase } from '@quizparty/validation';
import { hmacHex } from '../security/crypto';
import type { Clock } from '../util/clock';
import type { DecoySuggester, DecoySuggestion } from './decoys';
import type { Sealer } from './sealer';

export const RETENTION_MS = 30 * 86_400_000;

export type VaultResult =
  { ok: true } | { ok: false; code: ErrorCode; params?: Record<string, string | number> };

export interface TargetPrompt {
  promptId: string;
  position: number;
  source: 'CATALOG' | 'CUSTOM';
  catalogKey: string | null;
  text: string | null;
  /** What the target has stored: only ever returned to the target who holds the invite. */
  response: { answer: string; decoys: string[]; approved: boolean } | null;
}

export interface TargetView {
  quiz: { title: string; language: Locale };
  target: { name: string; consented: boolean };
  prompts: TargetPrompt[];
  /** Allow-listed capability hints for the page; booleans only, never configuration. */
  features: { suggestDecoys: boolean };
}

interface Payload {
  answer: string;
  decoys: string[];
}

const aadOf = (responseId: string, promptId: string): string => `${responseId}|${promptId}`;

/**
 * The only module that ever opens a personal answer (ADR-0015). Its public surface is exactly what
 * the design allows: the target, holding the invite, can write, read back, approve and delete their
 * own answers; the game can ask for the approved questions of a quiz at deck-building time. Nothing
 * here is reachable from a route that serves the quiz's creator, and no method returns a raw answer
 * for any other audience. An import test pins who may import this file.
 */
export class BlindVault {
  private readonly db: Database;
  private readonly sealer: Sealer | null;
  private readonly clock: Clock;
  private readonly secret: string;
  private readonly suggester: DecoySuggester | null;

  constructor(deps: {
    db: Database;
    sealer: Sealer | null;
    clock: Clock;
    secret: string;
    suggester?: DecoySuggester;
  }) {
    this.suggester = deps.suggester ?? null;
    this.db = deps.db;
    this.sealer = deps.sealer;
    this.clock = deps.clock;
    this.secret = deps.secret;
  }

  enabled(): boolean {
    return this.sealer !== null;
  }

  private requireSealer(): Sealer {
    if (!this.sealer) throw new Error('personal quizzes are not configured');
    return this.sealer;
  }

  inviteHash(token: string): string {
    return hmacHex(this.secret, 'blind-invite', token);
  }

  /** Name of the cookie that carries a target's claim; derived from the invite so one browser can hold several. */
  claimCookieName(token: string): string {
    return `qp_blind_${this.inviteHash(token).slice(0, 16)}`;
  }

  private claimHashOf(claim: string): string {
    return hmacHex(this.secret, 'blind-claim', claim);
  }

  /**
   * ADR-0015 / ATTACK 10: the invite link is also in the creator's hands, so it only opens the consent
   * step. Everything after it needs the claim secret minted at consent and kept by the target's browser.
   */
  private gate(
    target: { claimHash: string | null },
    claim: string | null,
  ): 'OK' | 'UNCLAIMED' | 'FORBIDDEN' {
    if (target.claimHash === null) return 'UNCLAIMED';
    if (claim === null || !/^[A-Za-z0-9_-]{43}$/u.test(claim)) return 'FORBIDDEN';
    const given = Buffer.from(this.claimHashOf(claim), 'hex');
    const stored = Buffer.from(target.claimHash, 'hex');
    return given.length === stored.length && timingSafeEqual(given, stored) ? 'OK' : 'FORBIDDEN';
  }

  /** A fresh 256-bit invite token; it exists only in the link the creator shares. */
  static newToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private retainUntil(): Date {
    return new Date(this.clock.now() + RETENTION_MS);
  }

  private async targetFor(token: string): Promise<{
    id: string;
    quizId: string;
    displayName: string;
    consentedAt: Date | null;
    claimHash: string | null;
    title: string;
    language: Locale;
  } | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const row = await this.db
      .selectFrom('blind_targets')
      .innerJoin('personal_quizzes', 'personal_quizzes.id', 'blind_targets.quiz_id')
      .select([
        'blind_targets.id as id',
        'blind_targets.quiz_id as quiz_id',
        'blind_targets.display_name as display_name',
        'blind_targets.consented_at as consented_at',
        'blind_targets.claim_hash as claim_hash',
        'personal_quizzes.title as title',
        'personal_quizzes.language as language',
        'personal_quizzes.kind as kind',
      ])
      .where('blind_targets.invite_hash', '=', this.inviteHash(token))
      .where('personal_quizzes.kind', '=', 'BLIND')
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      quizId: row.quiz_id,
      displayName: row.display_name,
      consentedAt: row.consented_at,
      claimHash: row.claim_hash,
      title: row.title,
      language: row.language as Locale,
    };
  }

  async view(token: string, claim: string | null): Promise<TargetView | null | 'FORBIDDEN'> {
    const sealer = this.requireSealer();
    const target = await this.targetFor(token);
    if (!target) return null;
    // Unclaimed means nobody has consented, so there is nothing stored to show yet.
    if (this.gate(target, claim) === 'FORBIDDEN') return 'FORBIDDEN';
    const prompts = await this.db
      .selectFrom('blind_prompts')
      .leftJoin('blind_responses', (join) =>
        join
          .onRef('blind_responses.prompt_id', '=', 'blind_prompts.id')
          .on('blind_responses.target_id', '=', target.id),
      )
      .select([
        'blind_prompts.id as prompt_id',
        'blind_prompts.position as position',
        'blind_prompts.source as source',
        'blind_prompts.catalog_key as catalog_key',
        'blind_prompts.text as text',
        'blind_responses.id as response_id',
        'blind_responses.sealed as sealed',
        'blind_responses.key_id as key_id',
        'blind_responses.approved_at as approved_at',
      ])
      .where('blind_prompts.quiz_id', '=', target.quizId)
      .orderBy('blind_prompts.position')
      .execute();
    return {
      features: { suggestDecoys: (await this.suggester?.available()) ?? false },
      quiz: { title: target.title, language: target.language },
      target: { name: target.displayName, consented: target.consentedAt !== null },
      prompts: prompts.map((row) => {
        let response: TargetPrompt['response'] = null;
        if (row.response_id && row.sealed && row.key_id) {
          const payload = JSON.parse(
            sealer.open(row.sealed, row.key_id, aadOf(row.response_id, row.prompt_id)),
          ) as Payload;
          response = { ...payload, approved: row.approved_at !== null };
        }
        return {
          promptId: row.prompt_id,
          position: row.position,
          source: row.source as 'CATALOG' | 'CUSTOM',
          catalogKey: row.catalog_key,
          text: row.text,
          response,
        };
      }),
    };
  }

  /**
   * The first consent claims the invite and hands back the claim secret (once; only its hash is kept).
   * Later calls need that secret. Whoever consents first owns the invite: if that is not the target,
   * the target is refused and tells the creator; the creator gains no access to anyone's answers.
   */
  async consent(
    token: string,
    claim: string | null,
  ): Promise<{ claim: string | null } | 'NOT_FOUND' | 'FORBIDDEN'> {
    const target = await this.targetFor(token);
    if (!target) return 'NOT_FOUND';
    if (target.claimHash !== null)
      return this.gate(target, claim) === 'OK' ? { claim: null } : 'FORBIDDEN';
    const fresh = randomBytes(32).toString('base64url');
    const row = await this.db
      .updateTable('blind_targets')
      .set({ claim_hash: this.claimHashOf(fresh), consented_at: new Date(this.clock.now()) })
      .where('id', '=', target.id)
      .where('claim_hash', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return row ? { claim: fresh } : 'FORBIDDEN';
  }

  /** Stores (or replaces) the target's answer to one prompt; a replaced answer must be approved again. */
  async put(
    token: string,
    claim: string | null,
    promptId: string,
    input: { answer: unknown; decoys: unknown },
  ): Promise<VaultResult | 'NOT_FOUND'> {
    const sealer = this.requireSealer();
    const target = await this.targetFor(token);
    if (!target) return 'NOT_FOUND';
    const access = this.gate(target, claim);
    if (access === 'UNCLAIMED') return { ok: false, code: 'CONSENT_REQUIRED' };
    if (access === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
    const prompt = await this.db
      .selectFrom('blind_prompts')
      .select('id')
      .where('id', '=', promptId)
      .where('quiz_id', '=', target.quizId)
      .executeTakeFirst();
    if (!prompt) return 'NOT_FOUND';

    const answer = sanitizeUserText(input.answer, { maxLength: BLIND_LIMITS.answerMax });
    if (!answer.ok) return { ok: false, code: 'TEXT_REJECTED', params: { reason: answer.reason } };
    if (!Array.isArray(input.decoys) || input.decoys.length > BLIND_LIMITS.decoysMax)
      return { ok: false, code: 'INVALID_MESSAGE' };
    const decoys: string[] = [];
    const seen = new Set([foldCase(answer.text)]);
    for (const raw of input.decoys as unknown[]) {
      const decoy = sanitizeUserText(raw, { maxLength: BLIND_LIMITS.answerMax });
      if (!decoy.ok) return { ok: false, code: 'TEXT_REJECTED', params: { reason: decoy.reason } };
      const key = foldCase(decoy.text);
      // A wrong alternative that equals the answer (or another alternative) would make the question unfair.
      if (seen.has(key))
        return { ok: false, code: 'TEXT_REJECTED', params: { reason: 'DUPLICATE' } };
      seen.add(key);
      decoys.push(decoy.text);
    }
    const payload = JSON.stringify({ answer: answer.text, decoys } satisfies Payload);
    await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('blind_responses')
        .select('id')
        .where('target_id', '=', target.id)
        .where('prompt_id', '=', promptId)
        .forUpdate()
        .executeTakeFirst();
      const id = existing?.id ?? randomUUID();
      const { sealed, keyId } = sealer.seal(payload, aadOf(id, promptId));
      const now = new Date(this.clock.now());
      if (existing)
        await trx
          .updateTable('blind_responses')
          .set({
            sealed,
            key_id: keyId,
            visibility_policy: 'TARGET_ONLY',
            approved_at: null,
            updated_at: now,
          })
          .where('id', '=', id)
          .execute();
      else
        await trx
          .insertInto('blind_responses')
          .values({ id, target_id: target.id, prompt_id: promptId, sealed, key_id: keyId })
          .execute();
      await trx
        .updateTable('personal_quizzes')
        .set({ updated_at: now, retain_until: this.retainUntil() })
        .where('id', '=', target.quizId)
        .execute();
    });
    return { ok: true };
  }

  /**
   * "Suggest alternatives for me" (ADR-0015 Bounded AI): the one place a stored answer is handed to
   * a remote system, and only the question wording (without the target's name) and that one answer.
   * The suggestions go back to the target to review; nothing is stored here. Off / failing / not
   * configured all answer with no suggestions, i.e. the target writes their own.
   */
  async suggestDecoys(
    token: string,
    claim: string | null,
    promptId: string,
  ): Promise<DecoySuggestion | 'NOT_FOUND' | { ok: false; code: ErrorCode }> {
    const sealer = this.requireSealer();
    const target = await this.targetFor(token);
    if (!target) return 'NOT_FOUND';
    const access = this.gate(target, claim);
    if (access === 'UNCLAIMED') return { ok: false, code: 'CONSENT_REQUIRED' };
    if (access === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
    const row = await this.db
      .selectFrom('blind_prompts')
      .innerJoin('blind_responses', (join) =>
        join
          .onRef('blind_responses.prompt_id', '=', 'blind_prompts.id')
          .on('blind_responses.target_id', '=', target.id),
      )
      .select([
        'blind_responses.id as response_id',
        'blind_responses.sealed as sealed',
        'blind_responses.key_id as key_id',
        'blind_prompts.source as source',
        'blind_prompts.catalog_key as catalog_key',
        'blind_prompts.text as text',
      ])
      .where('blind_prompts.id', '=', promptId)
      .where('blind_prompts.quiz_id', '=', target.quizId)
      .executeTakeFirst();
    if (!row) return 'NOT_FOUND';
    if (!this.suggester) return { decoys: [], source: 'NONE' };
    const payload = JSON.parse(
      sealer.open(row.sealed, row.key_id, aadOf(row.response_id, promptId)),
    ) as Payload;
    const wording =
      row.source === 'CATALOG'
        ? translate(target.language, `blind.catalog.${row.catalog_key}.prompt`)
        : (row.text ?? '');
    // A custom prompt may name the target; the model never needs to know who they are.
    const prompt = wording.replace(
      new RegExp(target.displayName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu'),
      target.language === 'tr' ? 'biri' : 'someone',
    );
    return this.suggester.suggest({ language: target.language, prompt, answer: payload.answer });
  }

  /** The target looked at the finished question privately and says yes (or takes it back). */
  async approve(
    token: string,
    claim: string | null,
    promptId: string,
    approved: boolean,
  ): Promise<VaultResult | 'NOT_FOUND'> {
    const target = await this.targetFor(token);
    if (!target) return 'NOT_FOUND';
    if (this.gate(target, claim) !== 'OK') return { ok: false, code: 'FORBIDDEN' };
    const row = await this.db
      .selectFrom('blind_responses')
      .select(['id'])
      .where('target_id', '=', target.id)
      .where('prompt_id', '=', promptId)
      .executeTakeFirst();
    if (!row) return 'NOT_FOUND';
    // An answer needs at least one wrong alternative before it can be a question.
    if (approved) {
      const sealer = this.requireSealer();
      const sealedRow = await this.db
        .selectFrom('blind_responses')
        .select(['sealed', 'key_id'])
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      const payload = JSON.parse(
        sealer.open(sealedRow.sealed, sealedRow.key_id, aadOf(row.id, promptId)),
      ) as Payload;
      if (payload.decoys.length < 1) return { ok: false, code: 'NOT_READY' };
    }
    await this.db
      .updateTable('blind_responses')
      .set(
        approved
          ? { approved_at: new Date(this.clock.now()), visibility_policy: 'GAME_ENGINE' }
          : { approved_at: null, visibility_policy: 'TARGET_ONLY' },
      )
      .where('id', '=', row.id)
      .execute();
    return { ok: true };
  }

  /** Immediate deletion on the target's request: the answers and the invite itself. */
  async deleteTarget(token: string, claim: string | null): Promise<boolean | 'FORBIDDEN'> {
    const target = await this.targetFor(token);
    if (!target) return false;
    // Before anyone consented there are no answers to protect; after, only the claim holder deletes.
    if (this.gate(target, claim) === 'FORBIDDEN') return 'FORBIDDEN';
    await this.db.deleteFrom('blind_targets').where('id', '=', target.id).execute();
    return true;
  }

  /**
   * The approved questions of a quiz as a deck, for the game engine only (deck building in the
   * realtime process). Question wording comes from fixed templates, never from a model; the correct
   * option is the target's own words and the others are the alternatives the target wrote and
   * approved. Returns opaque questions: nothing here says whose raw response each came from beyond
   * the target's display name the room is going to see anyway.
   */
  async playableForGame(quizId: string): Promise<DeckQuestion[]> {
    const sealer = this.requireSealer();
    const quiz = await this.db
      .selectFrom('personal_quizzes')
      .select(['language', 'kind'])
      .where('id', '=', quizId)
      .executeTakeFirst();
    if (!quiz || quiz.kind !== 'BLIND') return [];
    const language = quiz.language as Locale;
    const rows = await this.db
      .selectFrom('blind_responses')
      .innerJoin('blind_targets', 'blind_targets.id', 'blind_responses.target_id')
      .innerJoin('blind_prompts', 'blind_prompts.id', 'blind_responses.prompt_id')
      .select([
        'blind_responses.id as id',
        'blind_responses.sealed as sealed',
        'blind_responses.key_id as key_id',
        'blind_responses.prompt_id as prompt_id',
        'blind_targets.display_name as name',
        'blind_prompts.source as source',
        'blind_prompts.catalog_key as catalog_key',
        'blind_prompts.text as text',
      ])
      .where('blind_targets.quiz_id', '=', quizId)
      .where('blind_responses.approved_at', 'is not', null)
      .where('blind_targets.consented_at', 'is not', null)
      .execute();
    const questions: DeckQuestion[] = [];
    for (const row of rows) {
      const payload = JSON.parse(
        sealer.open(row.sealed, row.key_id, aadOf(row.id, row.prompt_id)),
      ) as Payload;
      if (payload.decoys.length < 1) continue;
      const text =
        row.source === 'CATALOG'
          ? translate(language, `blind.catalog.${row.catalog_key}.question`, { name: row.name })
          : translate(language, 'blind.question.custom', {
              name: row.name,
              prompt: row.text ?? '',
            });
      const options = [
        { key: randomUUID(), text: payload.answer, correct: true },
        ...payload.decoys.map((decoy) => ({ key: randomUUID(), text: decoy, correct: false })),
      ];
      for (let i = options.length - 1; i > 0; i -= 1) {
        const j = randomBytes(1)[0]! % (i + 1);
        [options[i], options[j]] = [options[j]!, options[i]!];
      }
      questions.push({
        questionId: row.id,
        source: 'BLIND',
        category: { id: 'personal', label: translate(language, 'blind.category') },
        difficulty: 'MEDIUM',
        text,
        explanation: translate(language, 'blind.reveal', { name: row.name }),
        options,
      });
    }
    return questions;
  }

  /** Marks the questions that were just put into a game and keeps the quiz for another 30 days. */
  async markUsed(quizId: string): Promise<void> {
    const now = new Date(this.clock.now());
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('blind_responses')
        .set({ visibility_policy: 'REVEALED_IN_GAME' })
        .where('visibility_policy', '=', 'GAME_ENGINE')
        .where('target_id', 'in', (eb) =>
          eb.selectFrom('blind_targets').select('id').where('quiz_id', '=', quizId),
        )
        .execute();
      await trx
        .updateTable('personal_quizzes')
        .set({ last_used_at: now, retain_until: this.retainUntil() })
        .where('id', '=', quizId)
        .execute();
    });
  }
}
