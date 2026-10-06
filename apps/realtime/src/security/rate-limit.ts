export interface BucketSpec {
  capacity: number;
  refillPerSec: number;
}

export interface TakeResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Token buckets keyed by `class:subject` (ADR-0018). In-memory by default; a Redis-backed
 * implementation of the same interface serves multi-instance deployments.
 */
export interface RateLimiter {
  take(key: string, spec: BucketSpec, cost?: number): TakeResult;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly scale = 1,
  ) {}

  start(intervalMs = 60_000): void {
    this.sweeper = setInterval(() => this.sweep(15 * 60_000), intervalMs);
    this.sweeper.unref();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  take(key: string, rawSpec: BucketSpec, cost = 1): TakeResult {
    const spec: BucketSpec = {
      capacity: rawSpec.capacity * this.scale,
      refillPerSec: rawSpec.refillPerSec * this.scale,
    };
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: spec.capacity, updatedAt: now };
    const elapsedSec = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(spec.capacity, bucket.tokens + elapsedSec * spec.refillPerSec);
    bucket.updatedAt = now;
    let result: TakeResult;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      result = { allowed: true, retryAfterMs: 0 };
    } else {
      const missing = cost - bucket.tokens;
      result = { allowed: false, retryAfterMs: Math.ceil((missing / spec.refillPerSec) * 1000) };
    }
    this.buckets.set(key, bucket);
    return result;
  }

  /** Drops buckets that have been idle long enough to be full again. */
  sweep(maxIdleMs: number): void {
    const cutoff = this.now() - maxIdleMs;
    for (const [key, bucket] of this.buckets)
      if (bucket.updatedAt < cutoff) this.buckets.delete(key);
  }

  size(): number {
    return this.buckets.size;
  }
}

export const LIMITS = {
  roomCreate: { capacity: 10, refillPerSec: 10 / 3600 },
  roomLookup: { capacity: 30, refillPerSec: 0.5 },
  catalog: { capacity: 60, refillPerSec: 1 },
  wsConnect: { capacity: 30, refillPerSec: 0.5 },
  join: { capacity: 10, refillPerSec: 0.2 },
  reconnect: { capacity: 30, refillPerSec: 1 },
  message: { capacity: 40, refillPerSec: 20 },
  answer: { capacity: 6, refillPerSec: 1 },
  /** COMMIT_PREP, USE_FIFTY_FIFTY, SET_PREFERENCES: a handful a round, never a flood. */
  power: { capacity: 8, refillPerSec: 0.5 },
  invalidMessage: { capacity: 8, refillPerSec: 0.2 },
} as const satisfies Record<string, BucketSpec>;
