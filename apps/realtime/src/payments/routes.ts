import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config';
import { apiError } from '../http/routes';
import { pseudonym } from '../security/crypto';
import type { SecurityLog } from '../security/events';
import { LIMITS, type RateLimiter } from '../security/rate-limit';
import { clientIp } from '../ws/gateway';
import type { AppleVerifier } from './apple';
import type { GoogleVerifier } from './google';
import type { LinkService } from './links';
import type { QuizService } from '../blind/quizzes';
import type { FeatureFlags } from '../flags/service';
import type { RoomManager } from '../rooms/manager';
import { EntitlementError, type EntitlementService } from './service';
import type { ErrorCode } from '@quizparty/protocol';
import { PurchaseError } from './types';

export interface PaymentRouteDeps {
  config: AppConfig;
  entitlements: EntitlementService;
  links: LinkService;
  manager: RoomManager;
  quizzes: QuizService;
  flags: FeatureFlags;
  /** Whether Blind Quizzes can be sealed at all (a key is configured). */
  blindEnabled: boolean;
  apple: AppleVerifier | null;
  google: GoogleVerifier | null;
  limiter: RateLimiter;
  security: SecurityLog;
  onError: (error: unknown) => void;
}

const STATUS: Partial<Record<string, number>> = {
  NOT_READY: 409,
  TIER_REQUIRED: 403,
  INVALID_STATE: 409,
  PURCHASE_INVALID: 422,
  PURCHASE_ACCOUNT_MISMATCH: 403,
  TRANSACTION_ALREADY_BOUND: 409,
  PURCHASE_PENDING: 409,
  PURCHASE_REFUNDED: 410,
  STORE_UNAVAILABLE: 503,
  FEATURE_DISABLED: 404,
  UNAUTHORIZED: 401,
};

const Claim = z.discriminatedUnion('platform', [
  z.strictObject({ platform: z.literal('IOS'), signedTransaction: z.string().min(20).max(20_000) }),
  z.strictObject({
    platform: z.literal('ANDROID'),
    productId: z.string().min(1).max(100),
    purchaseToken: z.string().min(10).max(2_000),
  }),
]);
const RestoreBody = z.strictObject({ purchases: z.array(Claim).min(1).max(10) });
const AppleBody = z.strictObject({ signedPayload: z.string().min(20).max(60_000) });
const GoogleBody = z.object({
  message: z.object({ data: z.string().max(20_000), messageId: z.string().min(1).max(100) }),
});
const GoogleEvent = z.object({
  packageName: z.string().max(200),
  oneTimeProductNotification: z
    .object({ purchaseToken: z.string().max(2_000), notificationType: z.number().int() })
    .optional(),
  voidedPurchaseNotification: z.object({ purchaseToken: z.string().max(2_000) }).optional(),
});

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function registerPaymentRoutes(app: FastifyInstance, deps: PaymentRouteDeps): void {
  const { config, entitlements, limiter } = deps;
  const ipHashOf = (request: FastifyRequest): string =>
    pseudonym(config.serverSecret, 'ip', clientIp(request.raw, config.trustProxyHops));

  const refuse = (reply: FastifyReply, error: unknown): FastifyReply => {
    if (error instanceof EntitlementError)
      return apiError(reply, STATUS[error.code] ?? 400, error.code);
    throw error;
  };
  /** Purchases belong to player accounts; a staff console session has no business here. */
  const player = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (request.auth?.kind === 'ADMIN') {
      apiError(reply, 403, 'FORBIDDEN');
      return false;
    }
    return true;
  };

  app.get(
    '/v1/entitlements',
    { config: { auth: 'session', limit: 'session' } },
    async (request, reply) => {
      if (!player(request, reply)) return reply;
      const accountId = request.auth!.account.id;
      return {
        ...(await entitlements.view(accountId)),
        // What the app hands the store at purchase time so the purchase is bound to this account.
        storeAccountToken: await entitlements.storeAccountToken(accountId),
        platforms: entitlements.platforms(),
      };
    },
  );

  app.post(
    '/v1/purchases/verify',
    { config: { auth: 'session', limit: 'purchase' } },
    async (request, reply) => {
      if (!player(request, reply)) return reply;
      const body = Claim.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      try {
        const outcome = await entitlements.redeem(request.auth!.account, body.data, 'GRANTED');
        return { ...outcome, ...(await entitlements.view(request.auth!.account.id)) };
      } catch (error) {
        return refuse(reply, error);
      }
    },
  );

  app.post(
    '/v1/purchases/restore',
    { config: { auth: 'session', limit: 'purchase' } },
    async (request, reply) => {
      if (!player(request, reply)) return reply;
      const body = RestoreBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      const results: { ok: boolean; code?: string }[] = [];
      for (const claim of body.data.purchases) {
        try {
          await entitlements.redeem(request.auth!.account, claim, 'RESTORED');
          results.push({ ok: true });
        } catch (error) {
          if (!(error instanceof EntitlementError)) throw error;
          results.push({ ok: false, code: error.code });
        }
      }
      return { results, ...(await entitlements.view(request.auth!.account.id)) };
    },
  );

  // ───────────── linking a TV room to the owner of the full game ─────────────
  const LinkToken = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/u) });

  app.get(
    '/v1/link-intents/:token',
    { config: { auth: 'session', limit: 'linkClaim' } },
    async (request, reply) => {
      if (!player(request, reply)) return reply;
      const accountId = request.auth!.account.id;
      const params = LinkToken.safeParse(request.params);
      const link = params.success ? await deps.links.peek(params.data.token, accountId) : null;
      const room = link ? deps.manager.get(link.roomId) : undefined;
      // One answer for unknown, used by someone else, expired and closed: a link says nothing about why it is dead.
      if (!room) return apiError(reply, 404, 'NOT_FOUND');
      const [blind, custom, whoSaidIt] = await Promise.all([
        deps.blindEnabled ? deps.flags.isEnabled('mode.blind_quiz') : false,
        deps.flags.isEnabled('mode.custom_quiz'),
        deps.flags.isEnabled('mode.who_said_it'),
      ]);
      const quizzes = (await deps.quizzes.list(accountId)).filter((q) =>
        q.kind === 'BLIND' ? blind : custom,
      );
      return {
        roomCode: room.code,
        tier: await entitlements.tierOf(accountId),
        mode: room.mode(),
        // Who Said It needs no quiz of the account's: the room's own players write it.
        whoSaidIt,
        quizzes: quizzes.map((q) => ({ id: q.id, kind: q.kind, title: q.title, ready: q.ready })),
      };
    },
  );

  app.post(
    '/v1/link-intents/:token/claim',
    { config: { auth: 'session', limit: 'linkClaim' } },
    async (request, reply) => {
      if (!player(request, reply)) return reply;
      const params = LinkToken.safeParse(request.params);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      const accountId = request.auth!.account.id;
      const claimed = await deps.links.claim(params.data.token, accountId);
      const room = claimed ? deps.manager.get(claimed.roomId) : undefined;
      if (!room) return apiError(reply, 404, 'NOT_FOUND');
      const tier = await entitlements.tierOf(accountId);
      // An account that owns the game unlocks the room now. One that does not is still linked
      // (when nobody else is), so buying afterwards unlocks this very room without scanning again.
      if (tier === 'FULL') await room.applyEntitlement('FULL', accountId, 'LINKED');
      else if (room.hostAccountId() === null && room.tier() === 'FREE')
        await room.applyEntitlement('FREE', accountId, 'LINKED');
      return { tier, roomCode: room.code };
    },
  );

  /**
   * Puts one of the signed-in account's personal quizzes into the room behind a link (or takes it out
   * again with `quizId: null`). The link proves the caller is at the TV; the account proves the quiz
   * is theirs; the room must be on the full game (an owner's account unlocks it on the way).
   * `{ mode: 'WHO_SAID_IT' }` selects the party mode instead: no quiz, same link, same tier rule, own flag.
   */
  app.post(
    '/v1/link-intents/:token/quiz',
    { config: { auth: 'session', limit: 'linkClaim' } },
    async (request, reply) => {
      if (!player(request, reply)) return reply;
      const params = LinkToken.safeParse(request.params);
      const body = z
        .union([
          z.strictObject({ quizId: z.uuid().nullable() }),
          z.strictObject({ mode: z.literal('WHO_SAID_IT') }),
        ])
        .safeParse(request.body);
      if (!params.success) return apiError(reply, 404, 'NOT_FOUND');
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      const accountId = request.auth!.account.id;
      const claimed = await deps.links.claim(params.data.token, accountId);
      const room = claimed ? deps.manager.get(claimed.roomId) : undefined;
      if (!room) return apiError(reply, 404, 'NOT_FOUND');

      const fail = (result: { ok: false; code: string }) =>
        apiError(reply, STATUS[result.code] ?? 409, result.code as ErrorCode);
      if ('mode' in body.data) {
        if (!(await deps.flags.isEnabled('mode.who_said_it')))
          return apiError(reply, 404, 'FEATURE_DISABLED');
        if (room.tier() !== 'FULL') {
          if ((await entitlements.tierOf(accountId)) !== 'FULL')
            return apiError(reply, 403, 'TIER_REQUIRED');
          await room.applyEntitlement('FULL', accountId, 'LINKED');
        }
        const result = await room.setContent('WHO_SAID_IT', null, null, null);
        return result.ok ? { mode: 'WHO_SAID_IT', title: null } : fail(result);
      }
      if (body.data.quizId === null) {
        const result = await room.setContent('CLASSIC', null, null, null);
        return result.ok ? { mode: 'CLASSIC', title: null } : fail(result);
      }
      const quiz = await deps.quizzes.forAttach(accountId, body.data.quizId);
      if (!quiz) return apiError(reply, 404, 'NOT_FOUND');
      const enabled =
        quiz.kind === 'BLIND'
          ? deps.blindEnabled && (await deps.flags.isEnabled('mode.blind_quiz'))
          : await deps.flags.isEnabled('mode.custom_quiz');
      if (!enabled) return apiError(reply, 404, 'FEATURE_DISABLED');
      if (!quiz.ready) return apiError(reply, 409, 'NOT_READY');
      // Personal quizzes are part of the full game: an owner's account unlocks the room on the way.
      if (room.tier() !== 'FULL') {
        if ((await entitlements.tierOf(accountId)) !== 'FULL')
          return apiError(reply, 403, 'TIER_REQUIRED');
        await room.applyEntitlement('FULL', accountId, 'LINKED');
      }
      const result = await room.setContent(quiz.kind, body.data.quizId, quiz.title, quiz.questions);
      return result.ok
        ? { mode: quiz.kind, title: quiz.title, rounds: quiz.questions }
        : fail(result);
    },
  );

  // ───────────── store server notifications (refunds and revocations) ─────────────
  app.post(
    '/v1/webhooks/apple',
    { config: { auth: 'public', limit: 'webhook' } },
    async (request, reply) => {
      const limit = limiter.take(`webhook:${ipHashOf(request)}`, LIMITS.webhook);
      if (!limit.allowed) return apiError(reply, 429, 'RATE_LIMITED');
      if (!deps.apple || !config.payments.enabled) return apiError(reply, 404, 'FEATURE_DISABLED');
      const body = AppleBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      try {
        const { notification, purchase } = await deps.apple.verifyNotification(
          body.data.signedPayload,
        );
        const kind = String(notification.notificationType);
        if ((kind === 'REFUND' || kind === 'REVOKE') && purchase && notification.notificationUUID)
          await entitlements.revoke(
            'IOS',
            { externalTransactionId: purchase.externalTransactionId },
            notification.notificationUUID,
          );
        return { ok: true };
      } catch (error) {
        if (error instanceof PurchaseError) {
          if (error.code === 'STORE_UNAVAILABLE') return apiError(reply, 503, 'STORE_UNAVAILABLE');
          deps.security.record('WEBHOOK_REFUSED', {
            ipHash: ipHashOf(request),
            detail: { platform: 'IOS' },
          });
          return apiError(reply, 400, 'INVALID_MESSAGE');
        }
        throw error;
      }
    },
  );

  // Google's Pub/Sub push carries the secret in the URL; its content is only a hint, because the
  // purchase is read again from Google before anything is taken away.
  app.post(
    '/v1/webhooks/google/:secret',
    { config: { auth: 'public', limit: 'webhook' } },
    async (request, reply) => {
      const limit = limiter.take(`webhook:${ipHashOf(request)}`, LIMITS.webhook);
      if (!limit.allowed) return apiError(reply, 429, 'RATE_LIMITED');
      const google = config.payments.google;
      if (!deps.google || !google || !config.payments.enabled)
        return apiError(reply, 404, 'FEATURE_DISABLED');
      const { secret } = request.params as { secret: string };
      if (!safeEqual(secret, google.webhookSecret)) {
        deps.security.record('WEBHOOK_REFUSED', {
          ipHash: ipHashOf(request),
          detail: { platform: 'ANDROID' },
        });
        return apiError(reply, 404, 'NOT_FOUND');
      }
      const body = GoogleBody.safeParse(request.body);
      if (!body.success) return apiError(reply, 400, 'INVALID_MESSAGE');
      let event: z.infer<typeof GoogleEvent>;
      try {
        event = GoogleEvent.parse(
          JSON.parse(Buffer.from(body.data.message.data, 'base64').toString('utf8')),
        );
      } catch {
        return apiError(reply, 400, 'INVALID_MESSAGE');
      }
      if (event.packageName !== google.packageName) return { ok: true };
      const token =
        event.voidedPurchaseNotification?.purchaseToken ??
        (event.oneTimeProductNotification?.notificationType === 2
          ? event.oneTimeProductNotification.purchaseToken
          : undefined);
      if (!token) return { ok: true };
      if (!(await entitlements.knowsToken(token))) return { ok: true };
      const hash = entitlements.tokenHash(token);
      try {
        const purchase = await deps.google.verify({
          platform: 'ANDROID',
          productId: google.productId,
          purchaseToken: token,
        });
        if (purchase.state === 'REVOKED')
          await entitlements.revoke(
            'ANDROID',
            { purchaseTokenHash: hash },
            body.data.message.messageId,
          );
        return { ok: true };
      } catch (error) {
        if (error instanceof PurchaseError && error.code === 'STORE_UNAVAILABLE')
          return apiError(reply, 503, 'STORE_UNAVAILABLE'); // Pub/Sub redelivers
        if (error instanceof PurchaseError) return { ok: true }; // unknown to Google: nothing to do
        throw error;
      }
    },
  );
}
