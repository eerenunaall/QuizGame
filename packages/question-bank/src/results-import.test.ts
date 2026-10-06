import { describe, expect, it } from 'vitest';
import { dimensionsFromScores, parseResults } from './results-import';

describe('what scores say about the dimensions', () => {
  it('passes a dimension at its rubric minimum, reviews anything below, fails a zero', () => {
    expect(
      dimensionsFromScores({
        factAccuracy: 4,
        answerFairness: 4,
        languageQuality: 4,
        aiSlopRisk: 4,
        distractorQuality: 4,
      }),
    ).toEqual({
      factCheck: 'PASS',
      ambiguity: 'PASS',
      grammar: 'PASS',
      style: 'PASS',
      distractorQuality: 'PASS',
    });
    expect(
      dimensionsFromScores({ factAccuracy: 3, languageQuality: 1, distractorQuality: 0 }),
    ).toEqual({
      factCheck: 'REVIEW',
      grammar: 'REVIEW',
      distractorQuality: 'FAIL',
    });
  });

  it('uses the lower minimum of three for difficulty, uniqueness, freshness and gameplay', () => {
    expect(
      dimensionsFromScores({
        difficultyAccuracy: 3,
        uniqueness: 3,
        freshness: 3,
        gameplayValue: 3,
      }),
    ).toEqual({
      difficulty: 'PASS',
      duplication: 'PASS',
      freshness: 'PASS',
      gameplayValue: 'PASS',
    });
    expect(dimensionsFromScores({ difficultyAccuracy: 2, gameplayValue: 2 })).toEqual({
      difficulty: 'REVIEW',
      gameplayValue: 'REVIEW',
    });
  });

  it('says nothing about what was not scored (clarity has no dimension of its own)', () => {
    expect(dimensionsFromScores({})).toEqual({});
    expect(dimensionsFromScores({ clarity: 5 })).toEqual({});
  });
});

describe('reading the results of a manual audit round', () => {
  const good = { questionId: 'q-1', status: 'PASS', scores: { factAccuracy: 5 } };

  it('reads one JSON object per line and keeps the line numbers of the problems', () => {
    const lines = parseResults(
      [
        JSON.stringify(good),
        '',
        '{not json',
        JSON.stringify({ ...good, status: 'MAYBE' }),
        JSON.stringify({ ...good, extra: 1 }),
      ].join('\n'),
    );
    expect(lines.map((line) => line.line)).toEqual([1, 3, 4, 5]);
    expect(lines[0]?.row).toMatchObject({
      questionId: 'q-1',
      status: 'PASS',
      hardRejectReasons: [],
      dimensions: {},
    });
    expect(lines[1]?.error).toBeDefined();
    expect(lines[2]?.error).toBe('invalid_row:status');
    expect(lines[3]?.error).toMatch(/^invalid_row/u);
  });

  it('accepts the revision the auditor was shown and an optional pass and provider', () => {
    const [line] = parseResults(
      JSON.stringify({ ...good, revision: 3, pass: 'AMBIGUITY', provider: 'vendor' }),
    );
    expect(line?.row).toMatchObject({ revision: 3, pass: 'AMBIGUITY', provider: 'vendor' });
  });

  it('refuses scores outside 0 to 5 and a revision that is not a positive whole number', () => {
    expect(
      parseResults(JSON.stringify({ ...good, scores: { factAccuracy: 6 } }))[0]?.error,
    ).toMatch(/^invalid_row/u);
    expect(
      parseResults(JSON.stringify({ ...good, scores: { factAccuracy: -1 } }))[0]?.error,
    ).toMatch(/^invalid_row/u);
    expect(parseResults(JSON.stringify({ ...good, revision: 0 }))[0]?.error).toMatch(
      /^invalid_row/u,
    );
    expect(parseResults(JSON.stringify({ ...good, revision: 1.5 }))[0]?.error).toMatch(
      /^invalid_row/u,
    );
  });
});
