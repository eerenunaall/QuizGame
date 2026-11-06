import type { AuditPassName, AuditPassResult } from '@quizparty/question-schema';
import type { AuditProvider, AuditProviderInput, ProviderResult } from '@quizparty/question-bank';

export type Answer = Partial<AuditPassResult>;

/** What a strong, clean question earns from each pass. */
export const GOOD: Record<string, Pick<AuditPassResult, 'dimensions' | 'scores'>> = {
  FACT_CHECK: {
    dimensions: { factCheck: 'PASS', freshness: 'PASS' },
    scores: { factAccuracy: 5, freshness: 5 },
  },
  AMBIGUITY: {
    dimensions: { ambiguity: 'PASS' },
    scores: { answerFairness: 5, clarity: 5 },
  },
  LANGUAGE: {
    dimensions: { grammar: 'PASS', style: 'PASS' },
    scores: { languageQuality: 5, aiSlopRisk: 5 },
  },
  DIFFICULTY: { dimensions: { difficulty: 'PASS' }, scores: { difficultyAccuracy: 4 } },
  GAMEPLAY: {
    dimensions: { gameplayValue: 'PASS', distractorQuality: 'PASS' },
    scores: { gameplayValue: 4, distractorQuality: 4 },
  },
};

/** A remote auditor that answers the way the rubric asks: PASS with strong scores unless told otherwise. */
export class Scripted implements AuditProvider {
  readonly calls: AuditProviderInput[] = [];
  constructor(
    readonly pass: AuditPassName,
    readonly id: string,
    private readonly answer: (input: AuditProviderInput) => Answer | Promise<Answer> = () => ({}),
    private readonly usage = { inputTokens: 100, outputTokens: 50 },
  ) {}
  async audit(input: AuditProviderInput): Promise<ProviderResult> {
    this.calls.push(input);
    const good = GOOD[this.pass]!;
    const override = await this.answer(input);
    return {
      result: {
        pass: this.pass,
        provider: this.id,
        status: 'PASS',
        dimensions: good.dimensions,
        scores: good.scores,
        reasonCodes: [],
        hardRejectReasons: [],
        reviewReasons: [],
        suggestedRewrite: null,
        ...override,
      },
      usage: this.usage,
    };
  }
}

export const PASSES = ['FACT_CHECK', 'AMBIGUITY', 'LANGUAGE', 'DIFFICULTY', 'GAMEPLAY'] as const;
export const panel = (
  answers: Partial<
    Record<AuditPassName, (input: AuditProviderInput) => Answer | Promise<Answer>>
  > = {},
): Scripted[] => PASSES.map((pass) => new Scripted(pass, 'test-panel', answers[pass]));
