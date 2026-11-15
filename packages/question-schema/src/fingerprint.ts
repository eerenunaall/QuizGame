import type { QuestionLanguage } from './enums';
import { sha256Hex } from './sha256';
import { contentTokens, foldKey } from './text';

/**
 * Duplicate detection building blocks (GDD §9.9): an exact lexical fingerprint, a MinHash
 * signature over character shingles, and (in `semantic.ts`) a vector proxy. The algorithms are
 * versioned: stored signatures are only comparable with signatures of the same version, so a
 * change here must bump `FINGERPRINT_VERSION` and recompute the bank (`question-audit
 * --recompute`).
 */
export const FINGERPRINT_VERSION = 1;
export const MINHASH_PERMUTATIONS = 128;
export const MINHASH_SHINGLE_SIZE = 4;
export const LSH_BANDS = 32;
export const LSH_ROWS = MINHASH_PERMUTATIONS / LSH_BANDS;

/** Exact-duplicate key: the same stem after case, diacritics, punctuation and spacing folding. */
export function lexicalFingerprint(language: QuestionLanguage, stem: string): string {
  return sha256Hex(`v${FINGERPRINT_VERSION}\u0000${language}\u0000${foldKey(stem, language)}`);
}

/** 32-bit MurmurHash3 over UTF-16 code units. Stable across runtimes. */
export function hash32(input: string, seed = 0): number {
  let h = seed >>> 0;
  const length = input.length;
  let index = 0;
  while (index + 2 <= length) {
    let k = (input.charCodeAt(index) & 0xffff) | ((input.charCodeAt(index + 1) & 0xffff) << 16);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
    index += 2;
  }
  if (index < length) {
    let k = input.charCodeAt(index) & 0xffff;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
  }
  h ^= length * 2;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Character shingles of a folded key, padded so word boundaries produce shingles of their own. */
export function shingles(key: string, size = MINHASH_SHINGLE_SIZE): Set<string> {
  const padded = ` ${key} `;
  const out = new Set<string>();
  if (padded.length <= size) {
    out.add(padded);
    return out;
  }
  for (let i = 0; i + size <= padded.length; i++) out.add(padded.slice(i, i + size));
  return out;
}

/**
 * What similarity is measured on: the content words of the stem plus the correct answer. Two
 * questions about the same fact share both; two questions that merely share a template do not.
 */
export function similarityKey(
  language: QuestionLanguage,
  stem: string,
  correctAnswer: string,
): string {
  const stemWords = contentTokens(stem, language);
  const answerWords = contentTokens(correctAnswer, language);
  return [...stemWords, '|', ...answerWords].join(' ');
}

// Permutation constants: fixed forever for FINGERPRINT_VERSION 1 (derived from a seeded generator).
const PERMUTATIONS = (() => {
  let state = hash32('quizparty-minhash-v1');
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const a = new Uint32Array(MINHASH_PERMUTATIONS);
  const b = new Uint32Array(MINHASH_PERMUTATIONS);
  for (let i = 0; i < MINHASH_PERMUTATIONS; i++) {
    a[i] = next() | 1; // odd multipliers are invertible mod 2^32
    b[i] = next();
  }
  return { a, b };
})();

/** MinHash signature as signed 32-bit integers (they map straight onto PostgreSQL `integer[]`). */
export function minhash(key: string): number[] {
  const hashes = [...shingles(key)].map((shingle) => hash32(shingle));
  const signature = new Array<number>(MINHASH_PERMUTATIONS);
  for (let i = 0; i < MINHASH_PERMUTATIONS; i++) {
    const multiplier = PERMUTATIONS.a[i]!;
    const offset = PERMUTATIONS.b[i]!;
    let min = 0xffffffff;
    for (const hash of hashes) {
      const value = (Math.imul(multiplier, hash) + offset) >>> 0;
      if (value < min) min = value;
    }
    signature[i] = min | 0;
  }
  return signature;
}

/** Estimated Jaccard similarity of the shingle sets behind two signatures. */
export function estimateJaccard(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let equal = 0;
  for (let i = 0; i < length; i++) if (a[i] === b[i]) equal++;
  return equal / length;
}

/** Exact Jaccard similarity of two folded keys' shingle sets (used to verify and in tests). */
export function exactJaccard(keyA: string, keyB: string): number {
  const a = shingles(keyA);
  const b = shingles(keyB);
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** One 32-bit hash per LSH band; two signatures that agree on a whole band share its bucket. */
export function bandHashes(signature: readonly number[]): number[] {
  const out: number[] = [];
  for (let band = 0; band < LSH_BANDS; band++) {
    let h = band * 0x9e3779b1;
    for (let row = 0; row < LSH_ROWS; row++) {
      h = Math.imul(h ^ (signature[band * LSH_ROWS + row] ?? 0), 0x85ebca6b);
      h ^= h >>> 15;
    }
    out.push(h >>> 0);
  }
  return out;
}
