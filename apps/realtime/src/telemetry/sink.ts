import type { Database } from '@quizparty/db';

/**
 * Product telemetry (GDD §25). Pseudonymous by construction: callers pass a hashed actor, and each
 * event name has an allow-list of property keys with primitive values only. Anything else is
 * dropped, so no nickname, answer text or payment data can end up here (ADR-0018).
 */
const ALLOWED: Record<string, readonly string[]> = {
  room_created: ['tier'],
  player_joined: ['players'],
  game_started: ['players', 'rounds'],
  rematch_started: ['players', 'rounds'],
  question_revealed: ['round', 'correctRatePermille'],
  game_finished: ['players', 'rounds'],
  room_closed: ['reason'],
  disconnect: ['role'],
  reconnect: ['role'],
};

export interface TelemetrySink {
  record(name: string, props: Record<string, string | number | boolean>, actor?: string): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export class DbTelemetrySink implements TelemetrySink {
  private buffer: {
    name: string;
    actor: string | null;
    props: Record<string, string | number | boolean>;
  }[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly onError: (error: unknown) => void,
    private readonly flushMs = 2_000,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.flushMs);
    this.timer.unref();
  }

  record(name: string, props: Record<string, string | number | boolean>, actor?: string): void {
    const allowed = ALLOWED[name];
    if (!allowed) return;
    const clean: Record<string, string | number | boolean> = {};
    for (const key of allowed) {
      const value = props[key];
      if (
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 40)
      ) {
        clean[key] = value;
      }
    }
    this.buffer.push({ name, actor: actor ?? null, props: clean });
    if (this.buffer.length >= 200) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.db
        .insertInto('telemetry_events')
        .values(
          batch.map((event) => ({
            name: event.name,
            actor: event.actor,
            props: JSON.stringify(event.props),
          })),
        )
        .execute();
    } catch (error) {
      this.onError(error);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}

export class NullTelemetrySink implements TelemetrySink {
  record(): void {}
  async flush(): Promise<void> {}
  async stop(): Promise<void> {}
}
