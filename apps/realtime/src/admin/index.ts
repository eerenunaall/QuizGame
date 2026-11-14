import type { FastifyInstance } from 'fastify';
import type { Database } from '@quizparty/db';
import type { AccountSessionService } from '../auth/account-sessions';
import type { AccountService } from '../auth/accounts';
import type { AppConfig } from '../config';
import type { FeatureFlags } from '../flags/service';
import type { RoomManager } from '../rooms/manager';
import type { Clock } from '../util/clock';
import type { VenueService } from '../venue/service';
import { AdminAudit } from './audit';
import type { AuditEngine } from './engine';
import { registerModerationRoutes } from './moderation';
import { registerQuestionRoutes } from './questions';
import { registerSystemRoutes } from './system';
import { registerVenueContentAdminRoutes } from './venue-content';
import { registerVenueAdminRoutes } from './venues';

export interface AdminDeps {
  config: AppConfig;
  db: Database;
  clock: Clock;
  manager: RoomManager;
  accounts: AccountService;
  accountSessions: AccountSessionService;
  flags: FeatureFlags;
  engine: AuditEngine;
  venues: VenueService;
}

/** The admin API (GDD §23). Every route here declares `auth: 'admin'` and the roles that may call it. */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const audit = new AdminAudit(deps.db, deps.config, app.log);
  registerQuestionRoutes(app, {
    config: deps.config,
    db: deps.db,
    clock: deps.clock,
    audit,
    engine: deps.engine,
  });
  registerModerationRoutes(app, {
    config: deps.config,
    db: deps.db,
    manager: deps.manager,
    audit,
    clock: deps.clock,
  });
  registerSystemRoutes(app, {
    db: deps.db,
    accounts: deps.accounts,
    accountSessions: deps.accountSessions,
    flags: deps.flags,
    manager: deps.manager,
    audit,
  });
  registerVenueAdminRoutes(app, { venues: deps.venues, audit, now: () => deps.clock.now() });
  registerVenueContentAdminRoutes(app, { db: deps.db, audit, now: () => deps.clock.now() });
}
