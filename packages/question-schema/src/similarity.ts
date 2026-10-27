import type { QuestionLanguage } from './enums';
import {
  bandHashes,
  estimateJaccard,
  lexicalFingerprint,
  minhash,
  similarityKey,
} from './fingerprint';
import { cosine, hashNgramVector } from './semantic';
import { contentTokens, foldKey } from './text';

/** Everything the duplicate search needs to know about one question. */
export interface SimilarityEntry {
  id: string;
  language: QuestionLanguage;
  lexical: string;
  /** Folded text of the correct option: "same question, different answer" is a conflict. */
  correctKey: string;
  minhash: readonly number[];
  /** Proxy (or provider) vector; null when the question has none yet. */
  vector: Float32Array | null;
  words: readonly string[];
}

export interface EntryInput {
  id: string;
  language: QuestionLanguage;
  stem: string;
  correctAnswer: string;
  /** Stored values, when the question comes from the database, save recomputing. */
  lexical?: string;
  minhash?: readonly number[];
  vector?: Float32Array | null;
}

export function buildEntry(input: EntryInput): SimilarityEntry {
  const { language, stem, correctAnswer } = input;
  return {
    id: input.id,
    language,
    lexical: input.lexical ?? lexicalFingerprint(language, stem),
    correctKey: foldKey(correctAnswer, language),
    minhash: input.minhash ?? minhash(similarityKey(language, stem, correctAnswer)),
    vector:
      input.vector === undefined
        ? hashNgramVector(`${stem} ${correctAnswer}`, language)
        : input.vector,
    words: [...new Set(contentTokens(`${stem} ${correctAnswer}`, language))],
  };
}

export interface SimilarityHit {
  id: string;
  jaccard: number;
  cosine: number | null;
  sameAnswer: boolean;
}

export interface NearOptions {
  minJaccard: number;
  minCosine: number;
  limit?: number;
}

/** A word shared by more questions than this is a template word, not evidence of similarity. */
const POSTING_LIMIT = 1_500;

/**
 * In-memory duplicate index: exact lexical fingerprints, MinHash with banded LSH for candidate
 * retrieval, and an inverted word index feeding the vector proxy. Built once per import or audit
 * run (a 50 000-question bank fits comfortably) and extended as the run accepts questions, so the
 * second copy inside one batch is caught as well as copies of stored questions.
 */
export class MemorySimilarityIndex {
  private readonly entries = new Map<string, SimilarityEntry>();
  private readonly lexicalIndex = new Map<string, string>();
  private readonly buckets: Map<number, string[]>[] = [];
  private readonly postings = new Map<string, string[]>();

  constructor() {
    for (let band = 0; band < 32; band++) this.buckets.push(new Map());
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  add(entry: SimilarityEntry): void {
    if (this.entries.has(entry.id)) return;
    this.entries.set(entry.id, entry);
    const lexicalKey = `${entry.language}\u0000${entry.lexical}`;
    if (!this.lexicalIndex.has(lexicalKey)) this.lexicalIndex.set(lexicalKey, entry.id);
    bandHashes(entry.minhash).forEach((hash, band) => {
      const bucket = this.buckets[band]!;
      const list = bucket.get(hash);
      if (list) list.push(entry.id);
      else bucket.set(hash, [entry.id]);
    });
    for (const word of entry.words) {
      const key = `${entry.language}\u0000${word}`;
      const list = this.postings.get(key);
      if (list) list.push(entry.id);
      else this.postings.set(key, [entry.id]);
    }
  }

  findLexical(language: QuestionLanguage, lexical: string): SimilarityEntry | undefined {
    const id = this.lexicalIndex.get(`${language}\u0000${lexical}`);
    return id === undefined ? undefined : this.entries.get(id);
  }

  nearest(entry: SimilarityEntry, options: NearOptions): SimilarityHit[] {
    const candidates = new Set<string>();
    bandHashes(entry.minhash).forEach((hash, band) => {
      for (const id of this.buckets[band]!.get(hash) ?? []) candidates.add(id);
    });
    const shared = new Map<string, number>();
    for (const word of entry.words) {
      const posting = this.postings.get(`${entry.language}\u0000${word}`);
      if (!posting || posting.length > POSTING_LIMIT) continue;
      for (const id of posting) shared.set(id, (shared.get(id) ?? 0) + 1);
    }
    const needed = Math.max(2, Math.ceil(entry.words.length * 0.5));
    for (const [id, count] of shared) if (count >= needed) candidates.add(id);

    const hits: SimilarityHit[] = [];
    for (const id of candidates) {
      if (id === entry.id) continue;
      const other = this.entries.get(id);
      if (!other || other.language !== entry.language) continue;
      const jaccard = estimateJaccard(entry.minhash, other.minhash);
      const similarity = entry.vector && other.vector ? cosine(entry.vector, other.vector) : null;
      if (jaccard >= options.minJaccard || (similarity !== null && similarity >= options.minCosine))
        hits.push({
          id,
          jaccard,
          cosine: similarity,
          sameAnswer: entry.correctKey === other.correctKey,
        });
    }
    hits.sort((a, b) => Math.max(b.jaccard, b.cosine ?? 0) - Math.max(a.jaccard, a.cosine ?? 0));
    return hits.slice(0, options.limit ?? 10);
  }
}
