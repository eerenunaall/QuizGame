import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_PASSES,
  AUDIT_STATUSES,
  ExternalAuditRowSchema,
  PassResultSchema,
  REQUIRED_MINIMUMS,
  SCORE_KEYS,
  arbitrate,
  externalRowToPass,
  heuristicPass,
  type AuditPassResult,
  type Scores,
} from './audit';
import { finding } from './findings';
import { DIMENSIONS } from './reasons';

const GOOD_SCORES: Scores = {
  factAccuracy: 5,
  clarity: 5,
  uniqueness: 4,
  distractorQuality: 4,
  languageQuality: 4,
  difficultyAccuracy: 4,
  gameplayValue: 4,
  answerFairness: 5,
  freshness: 5,
  aiSlopRisk: 4,
};

const pass = (patch: Partial<AuditPassResult> = {}): AuditPassResult =>
  PassResultSchema.parse({ pass: 'FACT_CHECK', provider: 'llm:test', status: 'PASS', ...patch });

const llm = (patch: Partial<AuditPassResult> = {}) =>
  pass({
    dimensions: {
      factCheck: 'PASS',
      ambiguity: 'PASS',
      grammar: 'PASS',
      style: 'PASS',
      distractorQuality: 'PASS',
      difficulty: 'PASS',
      gameplayValue: 'PASS',
    },
    scores: GOOD_SCORES,
    ...patch,
  });

const clean = heuristicPass([], { duplicatesChecked: true });

describe('arbitrate', () => {
  it('never lets heuristics alone approve: the fact check was not run', () => {
    const decision = arbitrate([clean]);
    expect(decision.status).toBe('REVIEW');
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining(['FACT_CHECK_NOT_RUN', 'SCORES_MISSING']),
    );
    expect(decision.dimensions.factCheck).toBe('NOT_RUN');
    expect(decision.dimensions.duplication).toBe('PASS');
    expect(decision.scores).toBeNull();
  });

  it('passes when heuristics are clean and a fact-check pass reached every minimum', () => {
    const decision = arbitrate([clean, llm()]);
    expect(decision).toMatchObject({ status: 'PASS', humanApproved: false, hardRejectReasons: [] });
    expect(decision.dimensions.factCheck).toBe('PASS');
  });

  it('holds back a question that misses one minimum score', () => {
    const decision = arbitrate([clean, llm({ scores: { ...GOOD_SCORES, languageQuality: 3 } })]);
    expect(decision.status).toBe('REVIEW');
    expect(decision.reasonCodes).toContain('SCORE_BELOW_MINIMUM:languageQuality');
  });

  it('holds back a question whose scores were never reported', () => {
    const decision = arbitrate([clean, llm({ scores: { factAccuracy: 5 } })]);
    expect(decision.status).toBe('REVIEW');
    expect(decision.reasonCodes).toContain('SCORES_MISSING');
  });

  it('merges scores conservatively across passes', () => {
    const decision = arbitrate([
      clean,
      llm(),
      llm({ pass: 'LANGUAGE', scores: { languageQuality: 3 } }),
    ]);
    expect(decision.scores?.languageQuality).toBe(3);
    expect(decision.status).toBe('REVIEW');
  });

  it('rejects on any hard-reject reason, however good the scores are', () => {
    const decision = arbitrate([clean, llm({ hardRejectReasons: ['INCORRECT_ANSWER'] })]);
    expect(decision.status).toBe('REJECT');
    expect(decision.hardRejectReasons).toEqual(['INCORRECT_ANSWER']);
  });

  it('rejects a pass that says REJECT even without naming a reason', () => {
    const decision = arbitrate([clean, llm({ status: 'REJECT', provider: 'llm:strict' })]);
    expect(decision).toMatchObject({
      status: 'REJECT',
      hardRejectReasons: ['REJECTED_BY:llm:strict'],
    });
  });

  it('treats a zero where the rubric says "false / duplicate / nonsense / broken" as a rejection', () => {
    for (const key of [
      'factAccuracy',
      'uniqueness',
      'distractorQuality',
      'languageQuality',
      'answerFairness',
      'freshness',
    ] as const) {
      const decision = arbitrate([clean, llm({ scores: { ...GOOD_SCORES, [key]: 0 } })]);
      expect(decision.status, key).toBe('REJECT');
      expect(decision.hardRejectReasons).toContain(`SCORE_ZERO:${key}`);
    }
    // A zero on gameplay value is only "boring": it blocks approval but is not a hard reject.
    expect(arbitrate([clean, llm({ scores: { ...GOOD_SCORES, gameplayValue: 0 } })]).status).toBe(
      'REVIEW',
    );
  });

  it('lets a heuristic REJECT finding override a model pass', () => {
    const bad = heuristicPass([finding('DUPLICATE_OPTIONS')]);
    const decision = arbitrate([bad, llm()]);
    expect(decision.status).toBe('REJECT');
    expect(decision.dimensions.distractorQuality).toBe('FAIL');
  });

  it('keeps a model REVIEW without reasons blocking', () => {
    const decision = arbitrate([clean, llm({ status: 'REVIEW' })]);
    expect(decision.status).toBe('REVIEW');
    expect(decision.reasonCodes).toContain('REVIEWER_VERDICT');
  });

  it('ignores earlier ARBITER rows: the decision is always recomputed from the passes', () => {
    const old = pass({ pass: 'ARBITER', status: 'PASS', dimensions: { factCheck: 'PASS' } });
    expect(arbitrate([old, clean]).status).toBe('REVIEW');
  });
});

describe('human approval', () => {
  const approval = (patch: Partial<AuditPassResult> = {}) =>
    pass({ pass: 'MANUAL', provider: 'editor', dimensions: { factCheck: 'PASS' }, ...patch });

  it('stands in for the fact check and the model scores, and waives earlier model REVIEW verdicts', () => {
    const decision = arbitrate([
      clean,
      llm({
        status: 'REVIEW',
        dimensions: { ambiguity: 'REVIEW' },
        reviewReasons: ['two answers possible?'],
      }),
      approval(),
    ]);
    expect(decision).toMatchObject({ status: 'PASS', humanApproved: true });
  });

  it('does not waive a model verdict that came after the approval', () => {
    const decision = arbitrate([
      clean,
      approval(),
      llm({ status: 'REVIEW', reviewReasons: ['new doubt'] }),
    ]);
    expect(decision.status).toBe('REVIEW');
  });

  it('never waives REJECT, hard-reject reasons or heuristic REJECT findings', () => {
    expect(
      arbitrate([clean, llm({ hardRejectReasons: ['FABRICATED_FACT'] }), approval()]).status,
    ).toBe('REJECT');
    expect(arbitrate([heuristicPass([finding('ANSWER_IN_QUESTION')]), approval()]).status).toBe(
      'REJECT',
    );
  });

  it('waives a heuristic REVIEW finding only when the editor acknowledged that exact code', () => {
    const findings = [finding('NEGATIVE_STEM'), finding('LENGTH_CLUE')];
    expect(arbitrate([heuristicPass(findings), approval()]).status).toBe('REVIEW');
    expect(
      arbitrate([heuristicPass(findings, { waived: ['NEGATIVE_STEM'] }), approval()]).status,
    ).toBe('REVIEW');
    const all = arbitrate([
      heuristicPass(findings, { waived: ['NEGATIVE_STEM', 'LENGTH_CLUE'] }),
      approval(),
    ]);
    expect(all.status).toBe('PASS');
  });

  it('cannot waive facts that only an edit fixes: sources, expiry, verification dates', () => {
    for (const code of [
      'SOURCE_REQUIRED_MISSING',
      'EXPIRED',
      'STALE_VERIFICATION',
      'REVERIFY_DUE',
    ] as const) {
      const decision = arbitrate([heuristicPass([finding(code)], { waived: [code] }), approval()]);
      expect(decision.status, code).toBe('REVIEW');
    }
  });

  it('requires the editor to have attested the fact check', () => {
    const decision = arbitrate([clean, approval({ dimensions: {} })]);
    expect(decision.humanApproved).toBe(false);
    expect(decision.status).toBe('REVIEW');
  });
});

describe('heuristicPass', () => {
  it('reports PASS for clean questions and lists examined dimensions only', () => {
    const result = heuristicPass([], { duplicatesChecked: false });
    expect(result).toMatchObject({ pass: 'HEURISTIC', status: 'PASS' });
    expect(result.dimensions.duplication).toBe('NOT_RUN');
    expect(result.dimensions.factCheck).toBe('NOT_RUN');
    expect(result.dimensions.ambiguity).toBe('PASS');
  });

  it('keeps INFO findings out of the status but in the record', () => {
    const result = heuristicPass([finding('NEVER_VERIFIED'), finding('MISSING_EXPLANATION')]);
    expect(result.status).toBe('PASS');
    expect(result.reasonCodes).toEqual(['NEVER_VERIFIED', 'MISSING_EXPLANATION']);
  });

  it('records which findings a waiver removed', () => {
    const result = heuristicPass([finding('NEGATIVE_STEM'), finding('LENGTH_CLUE_STRONG')], {
      waived: ['NEGATIVE_STEM', 'LENGTH_CLUE_STRONG'],
    });
    expect(result.status).toBe('REJECT'); // REJECT findings are never waivable
    expect(result.detail).toMatchObject({ waived: ['NEGATIVE_STEM'] });
  });
});

describe('external audit rows (manual round, GDD §28)', () => {
  const row = { questionId: 'tr-geo-001', status: 'PASS', scores: GOOD_SCORES };

  it('accepts the rubric §7 shape and turns it into a MANUAL pass by default', () => {
    const parsed = ExternalAuditRowSchema.parse(row);
    expect(externalRowToPass(parsed)).toMatchObject({
      pass: 'MANUAL',
      provider: 'manual',
      status: 'PASS',
      hardRejectReasons: [],
      suggestedRewrite: null,
    });
  });

  it('rejects unknown keys, bad statuses and out-of-range scores', () => {
    expect(ExternalAuditRowSchema.safeParse({ ...row, notes: 'x' }).success).toBe(false);
    expect(ExternalAuditRowSchema.safeParse({ ...row, status: 'MAYBE' }).success).toBe(false);
    expect(ExternalAuditRowSchema.safeParse({ ...row, scores: { factAccuracy: 6 } }).success).toBe(
      false,
    );
    expect(ExternalAuditRowSchema.safeParse({ ...row, scores: { fact_accuracy: 5 } }).success).toBe(
      false,
    );
    expect(ExternalAuditRowSchema.safeParse({ status: 'PASS' }).success).toBe(false);
  });
});

describe('arbiter invariants (property tests)', () => {
  const statusArb = fc.constantFrom(...AUDIT_STATUSES);
  const dimensionArb = fc.record(
    Object.fromEntries(
      DIMENSIONS.map((name) => [
        name,
        fc.constantFrom('PASS', 'REVIEW', 'FAIL', 'NOT_RUN' as const),
      ]),
    ),
    { requiredKeys: [] },
  );
  const scoresArb = fc.record(
    Object.fromEntries(SCORE_KEYS.map((key) => [key, fc.integer({ min: 0, max: 5 })])),
    { requiredKeys: [] },
  );
  const passArb = fc.record({
    pass: fc.constantFrom(...AUDIT_PASSES),
    provider: fc.constantFrom('heuristics@1', 'llm:a', 'llm:b', 'editor'),
    status: statusArb,
    dimensions: dimensionArb,
    scores: scoresArb,
    reasonCodes: fc.constant([] as string[]),
    hardRejectReasons: fc.array(fc.constantFrom('INCORRECT_ANSWER', 'TEMPLATE_SPAM'), {
      maxLength: 1,
    }),
    reviewReasons: fc.array(fc.constantFrom('NEGATIVE_STEM', 'x'), { maxLength: 2 }),
    suggestedRewrite: fc.constant(null),
  });
  const passesArb = fc.array(passArb, { maxLength: 6 });

  it('never says PASS without a passing fact check, any hard reason, or the minimum scores (absent a human)', () => {
    fc.assert(
      fc.property(passesArb, (passes) => {
        const decision = arbitrate(passes);
        if (decision.status !== 'PASS') return;
        expect(decision.dimensions.factCheck).toBe('PASS');
        expect(decision.hardRejectReasons).toEqual([]);
        expect(DIMENSIONS.some((name) => decision.dimensions[name] === 'FAIL')).toBe(false);
        if (!decision.humanApproved)
          for (const [key, minimum] of Object.entries(REQUIRED_MINIMUMS))
            expect(decision.scores?.[key as keyof Scores] ?? -1).toBeGreaterThanOrEqual(minimum);
      }),
      { numRuns: 500 },
    );
  });

  it('is monotone: adding a hard-reject reason can only make the outcome REJECT', () => {
    fc.assert(
      fc.property(passesArb, (passes) => {
        const worse = [
          ...(passes as AuditPassResult[]),
          pass({ pass: 'AMBIGUITY', hardRejectReasons: ['MULTIPLE_DEFENSIBLE_ANSWERS'] }),
        ];
        expect(arbitrate(worse).status).toBe('REJECT');
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic and independent of ARBITER rows', () => {
    fc.assert(
      fc.property(passesArb, (passes) => {
        const list = passes;
        const withArbiter = [
          pass({ pass: 'ARBITER', status: 'PASS', dimensions: { factCheck: 'PASS' } }),
          ...list,
        ];
        expect(arbitrate(withArbiter)).toEqual(arbitrate(list));
        expect(arbitrate(list)).toEqual(arbitrate(list));
      }),
      { numRuns: 200 },
    );
  });
});
