import type { Database } from '@quizparty/db';
import type { QuestionStatus } from '@quizparty/question-schema';
import { setLogContext } from './context';

export const ROLES = ['ADMIN', 'EDITOR', 'MODERATOR', 'SUPPORT'] as const;
export type Role = (typeof ROLES)[number];

/** Who is acting: an account with roles, or the system (maintenance, audit runs). */
export interface Actor {
  accountId: string | null;
  roles: readonly (Role | 'SYSTEM')[];
}

export const SYSTEM_ACTOR: Actor = { accountId: null, roles: ['SYSTEM'] };

export type LifecycleErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'AUDIT_REQUIRED'
  | 'OPTIONS_INVALID'
  | 'REJECT_FINDINGS'
  | 'BLOCKED'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'INVALID_CONTENT';

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;
  readonly detail: Record<string, unknown>;
  constructor(code: LifecycleErrorCode, detail: Record<string, unknown> = {}) {
    super(code);
    this.name = 'LifecycleError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Allowed status changes (GDD §9.5). The pipeline stages between DRAFT and APPROVED exist for
 * tooling; the application itself uses DRAFT (waiting for automatic passes), REVIEW (a person has
 * to look), APPROVED (the arbiter passed), ACTIVE (served) and RETIRED / REJECTED (never served).
 */
/** From any pipeline stage (DRAFT, GENERATED, … GAMEPLAY_REVIEW) a question may go here. */
const FROM_PIPELINE: readonly QuestionStatus[] = [
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'REJECTED',
  'RETIRED',
];

const ALLOWED: Partial<Record<QuestionStatus, readonly QuestionStatus[]>> = {
  REVIEW: ['DRAFT', 'APPROVED', 'REJECTED', 'RETIRED'],
  APPROVED: ['ACTIVE', 'REVIEW', 'RETIRED'],
  ACTIVE: ['REVIEW', 'RETIRED'],
  RETIRED: ['REVIEW'],
  REJECTED: ['REVIEW'],
};

/** Moderators may pull a question out of play; editors and admins run the whole lifecycle. */
const TARGET_ROLES: Record<string, readonly (Role | 'SYSTEM')[]> = {
  DRAFT: ['ADMIN', 'EDITOR', 'SYSTEM'],
  REVIEW: ['ADMIN', 'EDITOR', 'MODERATOR', 'SYSTEM'],
  APPROVED: ['ADMIN', 'EDITOR', 'SYSTEM'],
  // The system activates only when an operator enabled auto-activation (arbiter PASS still required).
  ACTIVE: ['ADMIN', 'EDITOR', 'SYSTEM'],
  REJECTED: ['ADMIN', 'EDITOR', 'SYSTEM'],
  RETIRED: ['ADMIN', 'EDITOR', 'MODERATOR', 'SYSTEM'],
};

export function canTransition(from: QuestionStatus, to: QuestionStatus): boolean {
  return (ALLOWED[from] ?? FROM_PIPELINE).includes(to);
}

export function mayTransition(actor: Actor, to: QuestionStatus): boolean {
  const allowed = TARGET_ROLES[to] ?? [];
  return actor.roles.some((role) => allowed.includes(role));
}

/** True when a person (not the system) with a content role is acting. */
export function isEditor(actor: Actor): boolean {
  return actor.roles.includes('ADMIN') || actor.roles.includes('EDITOR');
}

/** The guards of migration 0004 raise integrity errors; give them a name the API can map. */
export function mapDatabaseError(error: unknown): LifecycleError | null {
  const message = error instanceof Error ? error.message : '';
  if (/without a passing audit/u.test(message)) return new LifecycleError('AUDIT_REQUIRED');
  if (/exactly one correct|2-6 options/u.test(message))
    return new LifecycleError('OPTIONS_INVALID');
  if (/frozen/u.test(message)) return new LifecycleError('INVALID_TRANSITION', { frozen: true });
  return null;
}

export interface TransitionRequest {
  actor: Actor;
  reason: string;
  detail?: Record<string, unknown>;
  /** Free text shown in the retirement record. */
  note?: string;
}

/** Changes a status inside the caller's transaction, enforcing the table and the actor's role. */
export async function transitionTx(
  trx: Database,
  id: string,
  to: QuestionStatus,
  request: TransitionRequest,
): Promise<{ from: QuestionStatus; to: QuestionStatus }> {
  const row = await trx
    .selectFrom('questions')
    .select(['status', 'is_dev_seed'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new LifecycleError('NOT_FOUND');
  const from = row.status as QuestionStatus;
  if (from === to) return { from, to };
  if (!mayTransition(request.actor, to)) throw new LifecycleError('FORBIDDEN', { from, to });
  if (!canTransition(from, to)) throw new LifecycleError('INVALID_TRANSITION', { from, to });
  await setLogContext(trx, {
    actor: request.actor.accountId,
    reason: request.reason,
    detail: { ...request.detail, ...(request.note ? { note: request.note } : {}) },
  });
  try {
    await trx
      .updateTable('questions')
      .set({
        status: to,
        retired_at: to === 'RETIRED' ? new Date() : null,
        retire_reason: to === 'RETIRED' ? (request.note ?? request.reason) : null,
        ...(to === 'APPROVED' && !row.is_dev_seed ? { verification_status: 'VERIFIED' } : {}),
      })
      .where('id', '=', id)
      .execute();
  } catch (error) {
    throw mapDatabaseError(error) ?? error;
  }
  return { from, to };
}

export async function transitionQuestion(
  db: Database,
  id: string,
  to: QuestionStatus,
  request: TransitionRequest,
): Promise<{ from: QuestionStatus; to: QuestionStatus }> {
  return db.transaction().execute((trx) => transitionTx(trx, id, to, request));
}
