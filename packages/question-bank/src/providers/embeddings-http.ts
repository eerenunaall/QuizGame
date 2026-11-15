import { z } from 'zod';
import {
  normalize,
  type EmbeddingProvider,
  type QuestionLanguage,
} from '@quizparty/question-schema';

/**
 * Embeddings from any service that speaks the widely copied `/v1/embeddings` shape (hosted or a
 * local model server). When configured it replaces the feature-hash proxy: the provider id is
 * stored next to every vector, and vectors of different providers are never compared.
 */
export interface HttpEmbeddingOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const ResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().optional(), embedding: z.array(z.number()) })),
});

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  private readonly options: HttpEmbeddingOptions;

  constructor(options: HttpEmbeddingOptions) {
    this.options = options;
    this.id = `http:${options.model}`;
  }

  async embed(texts: readonly string[], _language: QuestionLanguage): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const send = this.options.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const response = await send(`${this.options.baseUrl.replace(/\/+$/u, '')}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.options.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`embedding service answered ${response.status}`);
      const parsed = ResponseSchema.parse(await response.json());
      if (parsed.data.length !== texts.length)
        throw new Error('embedding service returned the wrong count');
      const ordered = [...parsed.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return ordered.map((item) => normalize(Float32Array.from(item.embedding)));
    } finally {
      clearTimeout(timer);
    }
  }
}
