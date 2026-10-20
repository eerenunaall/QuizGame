import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LifecycleError, type Actor } from '@quizparty/question-bank';

/** Admin errors carry a machine code the console translates (`admin.error.<CODE>`); never prose. */
export function adminError(
  reply: FastifyReply,
  status: number,
  code: string,
  detail?: Record<string, unknown>,
): FastifyReply {
  return reply.code(status).send({ error: { code, ...(detail ? { detail } : {}) } });
}

export const Page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const IdParams = z.strictObject({ id: z.uuid() });

/** Parses or answers 400; returns null when it has answered. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  void adminError(reply, 400, 'INVALID_REQUEST', {
    fields: [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(body)')),
    ].slice(0, 10),
  });
  return null;
}

export function actorOf(request: FastifyRequest): Actor {
  const auth = request.auth!;
  return { accountId: auth.account.id, roles: auth.account.roles };
}

const STATUS_OF: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_TRANSITION: 409,
  AUDIT_REQUIRED: 409,
  BLOCKED: 409,
  DUPLICATE: 409,
  CONFLICT: 409,
  OPTIONS_INVALID: 422,
  REJECT_FINDINGS: 422,
  INVALID_CONTENT: 422,
};

/** Turns a question-bank refusal into the matching HTTP answer; rethrows anything else. */
export function lifecycleReply(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof LifecycleError)
    return adminError(reply, STATUS_OF[error.code] ?? 400, error.code, error.detail);
  throw error;
}

export const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export const isoOrNull = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

/** Escapes LIKE wildcards so a search term is a term, not a pattern. */
export const likeTerm = (term: string): string => `%${term.replace(/[%_\\]/gu, '\\$&')}%`;
