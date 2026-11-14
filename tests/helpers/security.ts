import type { TestServer } from './server';
import { waitUntil } from './wait';

/**
 * Security events are written off the request path (a log must never slow or break the game), so
 * tests poll for them instead of reading the table once.
 */
export async function waitForSecurityEvent(
  server: TestServer,
  where: { roomId?: string; sessionId?: string },
  kind: string,
  timeoutMs = 5_000,
): Promise<string[]> {
  return waitUntil(
    async () => {
      let query = server.db.db.selectFrom('security_events').select('kind');
      if (where.roomId) query = query.where('room_id', '=', where.roomId);
      if (where.sessionId) query = query.where('session_id', '=', where.sessionId);
      const kinds = (await query.execute()).map((row) => row.kind);
      return kinds.includes(kind) ? kinds : null;
    },
    timeoutMs,
    `security event ${kind}`,
  );
}
