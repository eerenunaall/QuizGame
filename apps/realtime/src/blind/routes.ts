import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BLIND_CATALOG_KEYS, LocaleSchema } from '@quizparty/protocol';
import type { FeatureFlags } from '../flags/service';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import type { AppConfig } from '../config';
import { clientIp } from '../ws/gateway';
import type { QuizService } from './quizzes';
import type { BlindVault } from './vault';

export interface BlindRouteDeps {
  config: AppConfig;
  quizzes: QuizService;
  vault: BlindVault;
  flags: FeatureFlags;
  limiter: RateLimiter;
}

const Id = z.uuid();
const QuizParams = z.strictObject({ id: Id });
const SUB = z.strictObject({ id: Id, sub: Id });
const Token = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) });
const TokenPrompt = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  promptId: Id,
});

const CreateQuiz = z.strictObject({
  kind: z.enum(['BLIND', 'CUSTOM']),
  title: z.string().max(240),
  language: LocaleSchema.default('tr'),
});
const AddPrompt = z.union([
  z.strictObject({ catalogKey: z.enum(BLIND_CATALOG_KEYS) }),
  z.strictObject({ text: z.string().max(560) }),
]);
const AddTarget = z.strictObject({ displayName: z.string().max(120) });
const AddQuestion = z.strictObject({
  text: z.string().max(800),
  options: z.array(z.string().max(320)).min(2).max(4),
  correctIndex: z.int().min(0).max(3),
  explanation: z.string().max(800).nullish(),
});
const Answer = z.strictObject({
  answer: z.string().max(560),
  decoys: z.array(z.string().max(560)).max(3),
});
const Approval = z.strictObject({ approved: z.boolean() });

/**
 * Personal quizzes (ADR-0015). Creator routes need a player sign-in and return completion status
 * only. Target routes need nothing but the 256-bit invite in the path; they are the only HTTP
 * routes that ever return a personal answer, and only to whoever holds that invite. Whole feature is
 * behind its flags and the sealing key: without them every route answers FEATURE_DISABLED.
 */
export function registerBlindRoutes(app: FastifyInstance, deps: BlindRouteDeps): void {
  const { config, quizzes, vault, flags, limiter } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(config.serverSecret, 'ip', clientIp(request.raw, config.trustProxyHops));

  const enabled = async (kind?: 'BLIND' | 'CUSTOM'): Promise<boolean> => {
    if (kind === 'CUSTOM') return flags.isEnabled('mode.custom_quiz');
    if (kind === 'BLIND') return vault.enabled() && (await flags.isEnabled('mode.blind_quiz'));
    return (
      (vault.enabled() && (await flags.isEnabled('mode.blind_quiz'))) ||
      (await flags.isEnabled('mode.custom_quiz'))
    );
  };
  /** Creator routes: a player (not a staff console session) of a build where the feature is on. */
  const creator = async (request: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    if (request.auth?.kind === 'ADMIN') {
      apiError(reply, 403, 'FORBIDDEN');
      return null;
    }
    if (!(await enabled())) {
      apiError(reply, 404, 'FEATURE_DISABLED');
      return null;
    }
    return request.auth!.account.id;
  };
  const bad = (reply: FastifyReply) => apiError(reply, 400, 'INVALID_MESSAGE');
  const notFound = (reply: FastifyReply) => apiError(reply, 404, 'NOT_FOUND');
  const refuse = (
    reply: FastifyReply,
    outcome: { code: Parameters<typeof apiError>[2]; params?: Record<string, string | number> },
  ) =>
    apiError(
      reply,
      outcome.code === 'LIMIT_REACHED' ? 409 : outcome.code === 'NOT_READY' ? 409 : 422,
      outcome.code,
      outcome.params,
    );

  // ───────────── creator ─────────────
  app.get('/v1/quizzes', { config: { auth: 'session', limit: 'quiz' } }, async (request, reply) => {
    const accountId = await creator(request, reply);
    if (!accountId) return reply;
    return { items: await quizzes.list(accountId), catalog: BLIND_CATALOG_KEYS };
  });

  app.post(
    '/v1/quizzes',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const body = CreateQuiz.safeParse(request.body);
      if (!body.success) return bad(reply);
      if (!(await enabled(body.data.kind))) return apiError(reply, 404, 'FEATURE_DISABLED');
      const result = await quizzes.create(accountId, body.data);
      return result.ok ? reply.code(201).send(result.value) : refuse(reply, result);
    },
  );

  app.get(
    '/v1/quizzes/:id',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = QuizParams.safeParse(request.params);
      const quiz = params.success ? await quizzes.get(accountId, params.data.id) : null;
      return quiz ?? notFound(reply);
    },
  );

  app.delete(
    '/v1/quizzes/:id',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = QuizParams.safeParse(request.params);
      if (!params.success || !(await quizzes.remove(accountId, params.data.id)))
        return notFound(reply);
      return { ok: true };
    },
  );

  app.post(
    '/v1/quizzes/:id/prompts',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = QuizParams.safeParse(request.params);
      const body = AddPrompt.safeParse(request.body);
      if (!params.success) return notFound(reply);
      if (!body.success) return bad(reply);
      const result = await quizzes.addPrompt(accountId, params.data.id, body.data);
      if (result === 'NOT_FOUND') return notFound(reply);
      return result.ok ? reply.code(201).send(result.value) : refuse(reply, result);
    },
  );

  app.delete(
    '/v1/quizzes/:id/prompts/:sub',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = SUB.safeParse(request.params);
      if (
        !params.success ||
        !(await quizzes.removePrompt(accountId, params.data.id, params.data.sub))
      )
        return notFound(reply);
      return { ok: true };
    },
  );

  app.post(
    '/v1/quizzes/:id/targets',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = QuizParams.safeParse(request.params);
      const body = AddTarget.safeParse(request.body);
      if (!params.success) return notFound(reply);
      if (!body.success) return bad(reply);
      const result = await quizzes.addTarget(accountId, params.data.id, body.data.displayName);
      if (result === 'NOT_FOUND') return notFound(reply);
      return result.ok ? reply.code(201).send(result.value) : refuse(reply, result);
    },
  );

  app.post(
    '/v1/quizzes/:id/targets/:sub/invite',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = SUB.safeParse(request.params);
      const invite = params.success
        ? await quizzes.rotateInvite(accountId, params.data.id, params.data.sub)
        : null;
      return invite ?? notFound(reply);
    },
  );

  app.delete(
    '/v1/quizzes/:id/targets/:sub',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = SUB.safeParse(request.params);
      if (
        !params.success ||
        !(await quizzes.removeTarget(accountId, params.data.id, params.data.sub))
      )
        return notFound(reply);
      return { ok: true };
    },
  );

  app.post(
    '/v1/quizzes/:id/questions',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      if (!(await enabled('CUSTOM'))) return apiError(reply, 404, 'FEATURE_DISABLED');
      const params = QuizParams.safeParse(request.params);
      const body = AddQuestion.safeParse(request.body);
      if (!params.success) return notFound(reply);
      if (!body.success) return bad(reply);
      const result = await quizzes.addQuestion(accountId, params.data.id, body.data);
      if (result === 'NOT_FOUND') return notFound(reply);
      return result.ok ? reply.code(201).send(result.value) : refuse(reply, result);
    },
  );

  app.delete(
    '/v1/quizzes/:id/questions/:sub',
    { config: { auth: 'session', limit: 'quiz' } },
    async (request, reply) => {
      const accountId = await creator(request, reply);
      if (!accountId) return reply;
      const params = SUB.safeParse(request.params);
      if (
        !params.success ||
        !(await quizzes.removeQuestion(accountId, params.data.id, params.data.sub))
      )
        return notFound(reply);
      return { ok: true };
    },
  );

  // ───────────── the person who answers (no account, just the invite) ─────────────
  const targetGate = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const limit = limiter.take(`blindRespond:${ipHashOf(request)}`, LIMITS.blindRespond);
    if (!limit.allowed) {
      apiError(reply, 429, 'RATE_LIMITED', { retryAfterMs: limit.retryAfterMs });
      return false;
    }
    if (!(await enabled('BLIND'))) {
      apiError(reply, 404, 'FEATURE_DISABLED');
      return false;
    }
    return true;
  };

  app.get(
    '/v1/blind/respond/:token',
    { config: { auth: 'public', limit: 'blindRespond' } },
    async (request, reply) => {
      if (!(await targetGate(request, reply))) return reply;
      const params = Token.safeParse(request.params);
      const view = params.success ? await vault.view(params.data.token) : null;
      void reply.header('cache-control', 'no-store');
      return view ?? notFound(reply);
    },
  );

  app.post(
    '/v1/blind/respond/:token/consent',
    { config: { auth: 'public', limit: 'blindRespond' } },
    async (request, reply) => {
      if (!(await targetGate(request, reply))) return reply;
      const params = Token.safeParse(request.params);
      if (!params.success || !(await vault.consent(params.data.token))) return notFound(reply);
      return { ok: true };
    },
  );

  app.put(
    '/v1/blind/respond/:token/prompts/:promptId',
    { config: { auth: 'public', limit: 'blindRespond' } },
    async (request, reply) => {
      if (!(await targetGate(request, reply))) return reply;
      const params = TokenPrompt.safeParse(request.params);
      const body = Answer.safeParse(request.body);
      if (!params.success) return notFound(reply);
      if (!body.success) return bad(reply);
      const result = await vault.put(params.data.token, params.data.promptId, body.data);
      if (result === 'NOT_FOUND') return notFound(reply);
      return result.ok ? { ok: true } : refuse(reply, result);
    },
  );

  app.post(
    '/v1/blind/respond/:token/prompts/:promptId/approval',
    { config: { auth: 'public', limit: 'blindRespond' } },
    async (request, reply) => {
      if (!(await targetGate(request, reply))) return reply;
      const params = TokenPrompt.safeParse(request.params);
      const body = Approval.safeParse(request.body);
      if (!params.success) return notFound(reply);
      if (!body.success) return bad(reply);
      const result = await vault.approve(
        params.data.token,
        params.data.promptId,
        body.data.approved,
      );
      if (result === 'NOT_FOUND') return notFound(reply);
      return result.ok ? { ok: true } : refuse(reply, result);
    },
  );

  app.delete(
    '/v1/blind/respond/:token',
    { config: { auth: 'public', limit: 'blindRespond' } },
    async (request, reply) => {
      if (!(await targetGate(request, reply))) return reply;
      const params = Token.safeParse(request.params);
      if (!params.success || !(await vault.deleteTarget(params.data.token))) return notFound(reply);
      return { ok: true };
    },
  );
}
