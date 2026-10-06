import { describe, expect, it } from 'vitest';
import {
  HASH_NGRAM_DIMENSIONS,
  HASH_NGRAM_PROVIDER,
  HashNgramEmbedder,
  cosine,
  decodeVector,
  encodeVector,
  hashNgramVector,
} from './semantic';

describe('hash n-gram vectors', () => {
  it('are unit length with the declared dimension', () => {
    const vector = hashNgramVector("Türkiye'nin başkenti neresidir? Ankara", 'tr');
    expect(vector).toHaveLength(HASH_NGRAM_DIMENSIONS);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
  });

  it('put re-worded and re-inflected copies close together and different facts far apart', () => {
    const base = hashNgramVector("Türkiye'nin başkenti neresidir? Ankara", 'tr');
    const reworded = hashNgramVector('Türkiye Cumhuriyeti’nin başkentidir? Ankara', 'tr');
    const unrelated = hashNgramVector('Suyun kimyasal formülü nedir? H2O', 'tr');
    expect(cosine(base, reworded)).toBeGreaterThan(0.5);
    expect(cosine(base, unrelated)).toBeLessThan(0.2);
    expect(cosine(base, base)).toBeCloseTo(1, 5);
  });

  it('survive quantisation to a compact string', () => {
    const vector = hashNgramVector('Nil Nehri hangi kıtada yer alır? Afrika', 'tr');
    const encoded = encodeVector(vector);
    expect(encoded.length).toBeLessThanOrEqual(344);
    const decoded = decodeVector(encoded);
    expect(cosine(vector, decoded)).toBeGreaterThan(0.999);
  });

  it('identify themselves honestly as the proxy provider', async () => {
    const embedder = new HashNgramEmbedder();
    expect(embedder.id).toBe(HASH_NGRAM_PROVIDER);
    expect(HASH_NGRAM_PROVIDER).toBe('hash-ngram');
    const [vector] = await embedder.embed(['Nil Nehri'], 'tr');
    expect(vector).toHaveLength(HASH_NGRAM_DIMENSIONS);
  });

  it('handles empty text without NaN', () => {
    const vector = hashNgramVector('', 'tr');
    expect(vector.every((value) => value === 0)).toBe(true);
    expect(cosine(vector, vector)).toBe(0);
  });
});
