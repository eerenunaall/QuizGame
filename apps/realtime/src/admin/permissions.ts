import type { Role } from '../auth/accounts';

/**
 * Who may do what in the admin console (GDD §23, ADR-0012). Every admin route names one of these;
 * the route table is the single place to read the access policy, and a test walks it.
 *
 * ADMIN does everything. EDITOR owns the content. MODERATOR handles what players run into: reports,
 * rooms, bans. SUPPORT can look, not touch.
 */
export const CAN = {
  questionsRead: ['ADMIN', 'EDITOR', 'MODERATOR'],
  questionsWrite: ['ADMIN', 'EDITOR'],
  /** MODERATOR may only pull a question out of play; the lifecycle enforces which targets. */
  questionsTransition: ['ADMIN', 'EDITOR', 'MODERATOR'],
  auditRun: ['ADMIN', 'EDITOR'],
  queueRead: ['ADMIN', 'EDITOR', 'MODERATOR'],
  reportsRead: ['ADMIN', 'EDITOR', 'MODERATOR'],
  reportsResolve: ['ADMIN', 'EDITOR', 'MODERATOR'],
  categoriesRead: ['ADMIN', 'EDITOR', 'MODERATOR', 'SUPPORT'],
  categoriesWrite: ['ADMIN', 'EDITOR'],
  roomsRead: ['ADMIN', 'MODERATOR', 'SUPPORT'],
  roomsAct: ['ADMIN', 'MODERATOR'],
  bansRead: ['ADMIN', 'MODERATOR', 'SUPPORT'],
  bansWrite: ['ADMIN', 'MODERATOR'],
  flagsRead: ['ADMIN', 'EDITOR', 'MODERATOR', 'SUPPORT'],
  flagsWrite: ['ADMIN'],
  usersRead: ['ADMIN', 'SUPPORT'],
  usersWrite: ['ADMIN'],
  incidentsRead: ['ADMIN', 'MODERATOR', 'SUPPORT'],
  incidentsWrite: ['ADMIN', 'MODERATOR'],
  securityRead: ['ADMIN', 'MODERATOR'],
  auditLogRead: ['ADMIN'],
  statsRead: ['ADMIN', 'EDITOR', 'MODERATOR', 'SUPPORT'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAN;
