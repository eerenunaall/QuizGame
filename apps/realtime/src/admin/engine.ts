import {
  AnthropicClient,
  HttpEmbeddingProvider,
  llmProviders,
  type AuditProvider,
} from '@quizparty/question-bank';
import type { EmbeddingProvider } from '@quizparty/question-schema';
import type { AppConfig } from '../config';

export interface AuditEngine {
  providers: AuditProvider[];
  embeddings?: EmbeddingProvider;
}

/** The pluggable remote parts of the audit pipeline, built from configuration; empty when unconfigured. */
export function buildAuditEngine(config: AppConfig): AuditEngine {
  const providers = config.audit
    ? llmProviders({
        client: new AnthropicClient({
          apiKey: config.audit.apiKey,
          ...(config.audit.apiBase ? { baseUrl: config.audit.apiBase } : {}),
        }),
        models: { fast: config.audit.modelFast, strong: config.audit.modelStrong },
      })
    : [];
  const embeddings = config.embeddings
    ? new HttpEmbeddingProvider({
        baseUrl: config.embeddings.baseUrl,
        model: config.embeddings.model,
        ...(config.embeddings.apiKey ? { apiKey: config.embeddings.apiKey } : {}),
      })
    : undefined;
  return { providers, ...(embeddings ? { embeddings } : {}) };
}
