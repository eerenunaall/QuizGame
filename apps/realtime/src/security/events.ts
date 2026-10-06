import type { Database } from '@quizparty/db';
import type { Clock } from '../util/clock';
import type { Metrics } from '../util/metrics';

/**
 * Persists security-relevant events (replayed packets, forged host commands, token reuse …) for
 * the admin incident log and red-team assertions. Writes are throttled per (kind, session) and
 * globally so an attacker cannot turn the log into a write amplifier.
 */
export class SecurityLog {
  private readonly lastByKey = new Map<string, number>();
  private windowStart = 0;
  private windowCount = 0;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly metrics: Metrics,
    private readonly onError: (error: unknown) => void,
  ) {}

  record(
    kind: string,
    context: {
      roomId?: string | null;
      sessionId?: string | null;
      ipHash?: string | null;
      detail?: Record<string, string | number | boolean>;
    } = {},
  ): void {
    this.metrics.security.inc({ kind });
    const now = this.clock.now();
    const key = `${kind}:${context.sessionId ?? context.ipHash ?? ''}`;
    const last = this.lastByKey.get(key);
    if (last !== undefined && now - last < 10_000) return;
    this.lastByKey.set(key, now);
    if (this.lastByKey.size > 5_000) {
      for (const [k, at] of this.lastByKey) if (now - at > 60_000) this.lastByKey.delete(k);
    }
    if (now - this.windowStart > 1_000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (++this.windowCount > 20) return;
    void this.db
      .insertInto('security_events')
      .values({
        kind,
        room_id: context.roomId ?? null,
        session_id: context.sessionId ?? null,
        ip_hash: context.ipHash ?? null,
        detail: JSON.stringify(context.detail ?? {}),
      })
      .execute()
      .catch(this.onError);
  }
}
