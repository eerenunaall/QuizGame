import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { Database } from '@quizparty/db';
import { clientIp } from '../ws/gateway';
import { pseudonym } from '../security/crypto';
import type { AppConfig } from '../config';

/**
 * The append-only record of what staff did (GDD §23). Written for every change, with who, what,
 * to what, and from which pseudonymous address; never with secrets, questions' answers or tokens.
 * The table refuses updates and deletes at the database level.
 */
export class AdminAudit {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  async record(
    request: FastifyRequest,
    action: string,
    target: { type: string; id?: string | null },
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    const auth = request.auth;
    const text = JSON.stringify(detail);
    try {
      await this.db
        .insertInto('admin_audit')
        .values({
          actor_account_id: auth?.account.id ?? null,
          actor_roles: [...(auth?.account.roles ?? [])],
          action,
          target_type: target.type,
          target_id: target.id ?? null,
          // Bounded: the log is not a place to dump a request body.
          detail: text.length > 4000 ? JSON.stringify({ truncated: true }) : text,
          ip_hash: pseudonym(
            this.config.serverSecret,
            'ip',
            clientIp(request.raw, this.config.trustProxyHops),
          ),
          request_id: request.id,
        })
        .execute();
    } catch (error) {
      // The change already happened; losing its record must be loud, never silent.
      this.log.error({ err: error, action, target }, 'admin audit write failed');
    }
  }
}
