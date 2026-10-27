import type { Database } from '@quizparty/db';
import type { Clock } from '../util/clock';

/**
 * Feature flags (GDD §22) held in the database and read through a short cache, so a switch flipped
 * in the admin console takes effect on every instance within `ttlMs` without a restart. A flag that
 * does not exist is off, and so is every flag while the database cannot be read: a missing switch
 * never turns a feature on.
 */
export interface FlagRow {
  key: string;
  enabled: boolean;
  public: boolean;
  description: string;
}

export class FeatureFlags {
  private cache: { at: number; flags: Map<string, FlagRow> } | null = null;
  private loading: Promise<Map<string, FlagRow>> | null = null;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly ttlMs = 15_000,
  ) {}

  private async load(): Promise<Map<string, FlagRow>> {
    const now = this.clock.now();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.flags;
    // One read at a time, however many callers arrive together.
    this.loading ??= (async () => {
      try {
        const rows = await this.db
          .selectFrom('feature_flags')
          .select(['key', 'enabled', 'public', 'description'])
          .execute();
        const flags = new Map(rows.map((row) => [row.key, row]));
        this.cache = { at: this.clock.now(), flags };
        return flags;
      } catch {
        // Keep serving the last known values when they exist; otherwise everything is off.
        return this.cache?.flags ?? new Map<string, FlagRow>();
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  async isEnabled(key: string): Promise<boolean> {
    return (await this.load()).get(key)?.enabled ?? false;
  }

  /** What clients may know: the public flags and nothing else. */
  async publicFlags(): Promise<Record<string, boolean>> {
    const flags = await this.load();
    const out: Record<string, boolean> = {};
    for (const flag of [...flags.values()].sort((a, b) => a.key.localeCompare(b.key)))
      if (flag.public) out[flag.key] = flag.enabled;
    return out;
  }

  /** Called after a change in this process; other instances catch up when their cache expires. */
  invalidate(): void {
    this.cache = null;
  }
}
