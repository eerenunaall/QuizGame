/**
 * Deterministic, serializable PRNG (sfc32) for game logic. The engine never calls Math.random():
 * every shuffle/selection is a pure function of the persisted state, so a room can be replayed
 * exactly after a crash (ADR-0006). This is not a cryptographic generator; secrets use
 * `random.ts` instead.
 */
export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function rngStateFromSeed(seed: string): RngState {
  const next = xmur3(seed);
  const rng = new Rng({ a: next(), b: next(), c: next(), d: next() });
  for (let i = 0; i < 15; i++) rng.nextU32(); // warm-up decorrelates similar seeds
  return rng.state();
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    this.a = state.a | 0;
    this.b = state.b | 0;
    this.c = state.c | 0;
    this.d = state.d | 0;
  }

  state(): RngState {
    return { a: this.a >>> 0, b: this.b >>> 0, c: this.c >>> 0, d: this.d >>> 0 };
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform integer in `[0, maxExclusive)` using rejection sampling. */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) {
      throw new RangeError('maxExclusive must be an integer in [1, 2^32]');
    }
    if (maxExclusive === 1) return 0;
    const limit = 0x100000000 - (0x100000000 % maxExclusive);
    for (;;) {
      const value = this.nextU32();
      if (value < limit) return value % maxExclusive;
    }
  }

  intBetween(minInclusive: number, maxInclusive: number): number {
    return minInclusive + this.int(maxInclusive - minInclusive + 1);
  }

  /** True with probability `permille / 1000` (integer permille keeps results float-free). */
  chance(permille: number): boolean {
    if (permille <= 0) return false;
    if (permille >= 1000) return true;
    return this.int(1000) < permille;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
    return items[this.int(items.length)]!;
  }

  /** Fisher–Yates shuffle of a copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }

  /** Index chosen proportionally to non-negative integer weights; uniform if all are zero. */
  weightedIndex(weights: readonly number[]): number {
    if (weights.length === 0) throw new RangeError('weights must not be empty');
    let total = 0;
    for (const w of weights) {
      if (!Number.isInteger(w) || w < 0)
        throw new RangeError('weights must be non-negative integers');
      total += w;
    }
    if (total === 0) return this.int(weights.length);
    let roll = this.int(total);
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }
}
