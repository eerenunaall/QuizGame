import { z } from 'zod';
import {
  AUDIT_STATUSES,
  DIMENSION_STATUSES,
  DIMENSIONS,
  SCORE_KEYS,
  type AuditPassName,
  type AuditPassResult,
  type Dimension,
  type DimensionStatus,
  type ScoreKey,
} from '@quizparty/question-schema';
import type { AuditProvider, AuditProviderInput, ProviderResult } from '../audit-runner';
import { BLIND_ANSWER_SYSTEM, PASS_SPECS } from './prompts';

/**
 * Model-backed audit passes over the Anthropic Messages API, using `fetch` only (no SDK, one less
 * dependency to trust). The API key, base URL and model names come from the environment: nothing
 * here names a model. Without a key the application simply has no such provider and the passes
 * stay NOT_RUN (ADR-0014).
 */
export interface LlmClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per request. */
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Injected so retry jitter is reproducible in tests. */
  random?: () => number;
}

export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export class LlmError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, retryable: boolean, status: number | null = null) {
    super(message);
    this.name = 'LlmError';
    this.retryable = retryable;
    this.status = status;
  }
}

const ResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

export class AnthropicClient {
  private readonly options: Required<Omit<LlmClientOptions, 'fetch'>> & { fetch: typeof fetch };

  constructor(options: LlmClientOptions) {
    this.options = {
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/u, ''),
      fetch: options.fetch ?? globalThis.fetch,
      timeoutMs: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 3,
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      random: options.random ?? Math.random,
    };
  }

  async complete(request: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<Completion> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.once(request);
      } catch (error) {
        const retryable = error instanceof LlmError ? error.retryable : true;
        if (!retryable || attempt >= this.options.maxRetries) throw error;
        const base = Math.min(30_000, 500 * 2 ** attempt);
        await this.options.sleep(base + Math.floor(this.options.random() * base * 0.25));
        attempt++;
      }
    }
  }

  private async once(request: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<Completion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.options.fetch(`${this.options.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          temperature: 0,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new LlmError(`model API answered ${response.status}`, retryable, response.status);
      }
      const parsed = ResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new LlmError('model API answered with an unexpected shape', false);
      const text = parsed.data.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('');
      return {
        text,
        inputTokens: parsed.data.usage?.input_tokens ?? 0,
        outputTokens: parsed.data.usage?.output_tokens ?? 0,
      };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      // Network failure or timeout: worth another try.
      throw new LlmError(error instanceof Error ? error.message : 'request failed', true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The first JSON object in a model reply, tolerating a code fence or a sentence around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new LlmError('the model reply holds no JSON object', false);
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    throw new LlmError('the model reply is not valid JSON', false);
  }
}

const ModelOutputSchema = z.strictObject({
  status: z.enum(AUDIT_STATUSES),
  scores: z.partialRecord(z.enum(SCORE_KEYS), z.number().min(0).max(5)).default({}),
  dimensions: z.partialRecord(z.enum(DIMENSIONS), z.enum(DIMENSION_STATUSES)).default({}),
  hardRejectReasons: z.array(z.string().max(120)).max(10).default([]),
  reviewReasons: z.array(z.string().max(240)).max(12).default([]),
  suggestedRewrite: z.string().max(2000).nullable().default(null),
});

const BlindAnswerSchema = z.object({
  answer: z.number().int().min(0).max(5).nullable(),
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().max(400).optional(),
});

export type ModelTier = 'fast' | 'strong';

/** Risk-based routing (rubric §8): spend the strong model where a mistake costs the most. */
export function routeModel(question: AuditProviderInput['question']): ModelTier {
  if (question.pool === 'CURRENT') return 'strong';
  if (question.difficulty === 'HARD' || question.difficulty === 'EXPERT') return 'strong';
  return ['history', 'science', 'business-economy', 'mythology-folklore'].includes(
    question.category,
  )
    ? 'strong'
    : 'fast';
}

export interface LlmPassOptions {
  client: AnthropicClient;
  pass: AuditPassName;
  models: { fast: string; strong: string };
  route?: (question: AuditProviderInput['question']) => ModelTier;
  maxOutputTokens?: number;
}

/** What the model is shown: the question as data, with the official answer only where the pass needs it. */
function questionDocument(input: AuditProviderInput, withAnswer: boolean): string {
  const { question } = input;
  return JSON.stringify(
    {
      today: input.today,
      language: question.language,
      category: question.category,
      labelledDifficulty: question.difficulty,
      pool: question.pool,
      question: question.text,
      options: question.options.map((option) => option.text),
      ...(withAnswer
        ? {
            officialAnswerIndex: question.options.findIndex((option) => option.correct),
            explanation: question.explanation,
            sources: question.sources,
            expiresAt: question.expiresAt,
            lastVerifiedAt: question.lastVerifiedAt,
          }
        : {}),
    },
    null,
    1,
  );
}

/**
 * Keeps only what this pass is entitled to say, and keeps a single model from rejecting a question
 * on a whim: a FAIL, a REJECT or a score of 0 counts as a rejection only when the model names one
 * of the hard-reject reasons the rubric allows for this pass; otherwise it asks for a human.
 */
function restrict(
  output: z.output<typeof ModelOutputSchema>,
  spec: {
    dimensions: readonly Dimension[];
    scores: readonly ScoreKey[];
    hardRejects: readonly string[];
  },
): Pick<AuditPassResult, 'dimensions' | 'scores' | 'hardRejectReasons' | 'reviewReasons'> {
  const hardRejectReasons = output.hardRejectReasons.filter((code) =>
    spec.hardRejects.includes(code),
  );
  const reviewReasons = output.reviewReasons.slice();
  for (const code of output.hardRejectReasons)
    if (!spec.hardRejects.includes(code))
      reviewReasons.push(`unlisted reason reported by the model: ${code}`);
  const named = hardRejectReasons.length > 0;

  const dimensions: Partial<Record<Dimension, DimensionStatus>> = {};
  for (const name of spec.dimensions) {
    const value = output.dimensions[name];
    if (value === undefined) continue;
    dimensions[name] = value === 'FAIL' && !named ? 'REVIEW' : value;
    if (value === 'FAIL' && !named)
      reviewReasons.push(`${name} judged FAIL without a listed hard-reject reason`);
  }
  const scores: Partial<Record<ScoreKey, number>> = {};
  for (const key of spec.scores) {
    const value = output.scores[key];
    if (value === undefined) continue;
    if (value === 0 && !named) {
      scores[key] = 1;
      reviewReasons.push(`${key} of 0 reported without a listed hard-reject reason`);
    } else scores[key] = value;
  }
  return { dimensions, scores, hardRejectReasons, reviewReasons };
}

export class LlmPassProvider implements AuditProvider {
  readonly id: string;
  readonly pass: AuditPassName;

  constructor(private readonly options: LlmPassOptions) {
    const spec = PASS_SPECS[options.pass];
    if (!spec) throw new Error(`no prompt for the ${options.pass} pass`);
    this.pass = options.pass;
    this.id = `llm:${options.models.fast}/${options.models.strong}`;
  }

  async audit(input: AuditProviderInput): Promise<ProviderResult> {
    const spec = PASS_SPECS[this.pass]!;
    const tier = (this.options.route ?? routeModel)(input.question);
    const model = this.options.models[tier];
    const maxTokens = this.options.maxOutputTokens ?? 700;
    let inputTokens = 0;
    let outputTokens = 0;
    const extra: Record<string, unknown> = { model, tier };

    if (this.pass === 'FACT_CHECK') {
      // Step one: answer blind. A disagreement with the official answer is a signal for a human.
      const blind = await this.options.client.complete({
        model,
        system: BLIND_ANSWER_SYSTEM,
        user: questionDocument(input, false),
        maxTokens: 200,
      });
      inputTokens += blind.inputTokens;
      outputTokens += blind.outputTokens;
      const answer = BlindAnswerSchema.parse(extractJson(blind.text));
      const official = input.question.options.findIndex((option) => option.correct);
      extra.blind = { answer: answer.answer, official, agrees: answer.answer === official };
      if (answer.answer !== official) {
        return {
          result: {
            pass: this.pass,
            provider: this.id,
            status: 'REVIEW',
            dimensions: { factCheck: 'REVIEW' },
            scores: {},
            reasonCodes: [],
            hardRejectReasons: [],
            reviewReasons: [
              answer.answer === null
                ? 'blind check: the model could not defend a single option'
                : 'blind check: the model chose a different option than the official answer',
            ],
            suggestedRewrite: null,
            detail: extra,
          },
          usage: { inputTokens, outputTokens },
        };
      }
    }

    const completion = await this.options.client.complete({
      model,
      system: spec.system,
      user: questionDocument(input, true),
      maxTokens,
    });
    inputTokens += completion.inputTokens;
    outputTokens += completion.outputTokens;
    const output = ModelOutputSchema.parse(extractJson(completion.text));
    const restricted = restrict(output, spec);
    // The pass is only a PASS if it says so and names nothing that needs a human.
    if (output.status === 'REJECT' && restricted.hardRejectReasons.length === 0)
      restricted.reviewReasons.push('the model said REJECT without a listed hard-reject reason');
    const status =
      restricted.hardRejectReasons.length > 0
        ? 'REJECT'
        : restricted.reviewReasons.length > 0 || output.status === 'REJECT'
          ? 'REVIEW'
          : output.status;
    return {
      result: {
        pass: this.pass,
        provider: this.id,
        status,
        ...restricted,
        reasonCodes: [],
        suggestedRewrite: output.suggestedRewrite,
        detail: extra,
      },
      usage: { inputTokens, outputTokens },
    };
  }
}

/** The five passes of the pipeline (rubric §8), sharing one client and model pair. */
export function llmProviders(options: Omit<LlmPassOptions, 'pass'>): LlmPassProvider[] {
  return (['FACT_CHECK', 'AMBIGUITY', 'LANGUAGE', 'DIFFICULTY', 'GAMEPLAY'] as const).map(
    (pass) => new LlmPassProvider({ ...options, pass }),
  );
}
