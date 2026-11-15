import { afterEach, describe, expect, it } from 'vitest';
import { startHttpDouble, type HttpDouble, type RecordedRequest, type Reply } from '../testing';
import { HttpEmbeddingProvider } from './embeddings-http';

const doubles: HttpDouble[] = [];
afterEach(async () => {
  await Promise.all(doubles.splice(0).map((double) => double.close()));
});
async function serve(
  handler: (request: RecordedRequest, index: number) => Reply,
): Promise<HttpDouble> {
  const double = await startHttpDouble(handler);
  doubles.push(double);
  return double;
}
const norm = (vector: Float32Array): number => Math.hypot(...vector);

describe('embeddings over HTTP', () => {
  it('sends the model and the texts, authenticates when it has a key and names itself after the model', async () => {
    const server = await serve(() => ({
      json: {
        data: [
          { index: 0, embedding: [3, 4] },
          { index: 1, embedding: [0, 2] },
        ],
      },
    }));
    const provider = new HttpEmbeddingProvider({
      baseUrl: `${server.url}//`,
      model: 'embed-small',
      apiKey: 'sk-test',
    });
    expect(provider.id).toBe('http:embed-small');
    const vectors = await provider.embed(['bir', 'iki'], 'tr');
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: '/v1/embeddings',
      body: { model: 'embed-small', input: ['bir', 'iki'] },
    });
    expect(server.requests[0]!.headers.authorization).toBe('Bearer sk-test');
    expect(vectors).toHaveLength(2);
    expect(Array.from(vectors[0]!)).toEqual([expect.closeTo(0.6, 5), expect.closeTo(0.8, 5)]);
    expect(vectors.every((vector) => Math.abs(norm(vector) - 1) < 1e-6)).toBe(true);
  });

  it('sends no credentials when it has none (a local model server)', async () => {
    const server = await serve(() => ({ json: { data: [{ embedding: [1, 0] }] } }));
    await new HttpEmbeddingProvider({ baseUrl: server.url, model: 'm' }).embed(['x'], 'tr');
    expect(server.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('returns the vectors in the order of the texts even when the service answers in another order', async () => {
    const server = await serve(() => ({
      json: {
        data: [
          { index: 2, embedding: [0, 0, 1] },
          { index: 0, embedding: [1, 0, 0] },
          { index: 1, embedding: [0, 1, 0] },
        ],
      },
    }));
    const vectors = await new HttpEmbeddingProvider({ baseUrl: server.url, model: 'm' }).embed(
      ['a', 'b', 'c'],
      'tr',
    );
    expect(vectors.map((vector) => Array.from(vector))).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('asks nothing when there is nothing to embed', async () => {
    const server = await serve(() => ({ json: {} }));
    expect(
      await new HttpEmbeddingProvider({ baseUrl: server.url, model: 'm' }).embed([], 'tr'),
    ).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });

  it.each([
    ['an error status', { status: 500, json: {} }, /answered 500/u],
    ['a body of the wrong shape', { json: { vectors: [] } }, /./u],
    ['too few vectors', { json: { data: [{ embedding: [1] }] } }, /wrong count/u],
    [
      'too many vectors',
      { json: { data: [{ embedding: [1] }, { embedding: [1] }, { embedding: [1] }] } },
      /wrong count/u,
    ],
    [
      'text where numbers belong',
      { json: { data: [{ embedding: ['a'] }, { embedding: [1] }] } },
      /./u,
    ],
  ] as const)('refuses %s instead of storing a wrong vector', async (_name, answer, message) => {
    const server = await serve(() => answer);
    await expect(
      new HttpEmbeddingProvider({ baseUrl: server.url, model: 'm' }).embed(['a', 'b'], 'tr'),
    ).rejects.toThrow(message);
  });

  it('gives up on a service that never answers', async () => {
    const server = await serve(() => ({ hang: true }));
    await expect(
      new HttpEmbeddingProvider({ baseUrl: server.url, model: 'm', timeoutMs: 40 }).embed(
        ['a'],
        'tr',
      ),
    ).rejects.toThrow();
  });
});
