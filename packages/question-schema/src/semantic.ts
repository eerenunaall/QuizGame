import type { QuestionLanguage } from './enums';
import { hash32 } from './fingerprint';
import { fromBase64, toBase64 } from './runtime';
import { contentTokens } from './text';

/**
 * Semantic proximity.
 *
 * Real semantic duplicate detection needs an embedding model, which the sandbox does not have
 * (ADR-0014). `HashNgramEmbedder` is an honest stand-in: a feature-hashed vector of word and
 * character n-grams. It catches re-worded and re-inflected copies of the same words, **not**
 * paraphrases with different vocabulary, so it is recorded as `semantic_provider = 'hash-ngram'`
 * and can only escalate a question to REVIEW, never clear it. When an external provider is
 * configured, vectors from it replace these and the provider id says so.
 */
export const HASH_NGRAM_PROVIDER = 'hash-ngram';
export const HASH_NGRAM_DIMENSIONS = 256;

export interface EmbeddingProvider {
  /** Stored next to every vector (`semantic_provider`). */
  readonly id: string;
  embed(texts: readonly string[], language: QuestionLanguage): Promise<Float32Array[]>;
}

function addFeature(vector: Float32Array, feature: string, weight: number): void {
  const hash = hash32(feature, 0x51ed270b);
  const index = hash % vector.length;
  const sign = (hash >>> 8) & 1 ? 1 : -1;
  vector[index] = (vector[index] ?? 0) + sign * weight;
}

export function hashNgramVector(text: string, language: QuestionLanguage): Float32Array {
  const vector = new Float32Array(HASH_NGRAM_DIMENSIONS);
  const words = contentTokens(text, language);
  for (const [position, word] of words.entries()) {
    addFeature(vector, `w:${word}`, 1);
    const next = words[position + 1];
    if (next !== undefined) addFeature(vector, `b:${word} ${next}`, 0.8);
    const padded = `^${word}$`;
    // Character trigrams keep inflected forms ("baskenti", "baskentidir") close together.
    for (let i = 0; i + 3 <= padded.length; i++)
      addFeature(vector, `c:${padded.slice(i, i + 3)}`, 0.3);
  }
  return normalize(vector);
}

export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  if (sum === 0) return vector;
  const scale = 1 / Math.sqrt(sum);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! * scale;
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/** Int8 quantisation: 256 dimensions become a 344-character base64 string in `semantic_fingerprint`. */
export function encodeVector(vector: ArrayLike<number>): string {
  let binary = '';
  for (let i = 0; i < vector.length; i++) {
    const quantised = Math.max(-127, Math.min(127, Math.round(vector[i]! * 127)));
    binary += String.fromCharCode(quantised & 0xff);
  }
  return toBase64(binary);
}

export function decodeVector(encoded: string): Float32Array {
  const binary = fromBase64(encoded);
  const out = new Float32Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    const byte = binary.charCodeAt(i);
    out[i] = (byte > 127 ? byte - 256 : byte) / 127;
  }
  return out;
}

export class HashNgramEmbedder implements EmbeddingProvider {
  readonly id = HASH_NGRAM_PROVIDER;
  embed(texts: readonly string[], language: QuestionLanguage): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((text) => hashNgramVector(text, language)));
  }
}
