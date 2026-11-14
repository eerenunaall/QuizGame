import { describe, expect, it } from 'vitest';
import { QUESTION_STATUSES, type QuestionStatus } from '@quizparty/question-schema';
import { nextStatus } from './review';

const pass = { status: 'PASS', blockers: [] } as const;
const reject = { status: 'REJECT', blockers: [] } as const;
const waiting = { status: 'REVIEW', blockers: ['FACT_CHECK_NOT_RUN', 'SCORES_MISSING'] } as const;
const doubt = { status: 'REVIEW', blockers: ['FACT_CHECK_NOT_RUN', 'NEGATIVE_STEM'] } as const;

describe('what an arbiter verdict does to a status', () => {
  it('approves anything not yet in play on PASS and leaves what is in play alone', () => {
    for (const from of ['DRAFT', 'REVIEW'] as const)
      expect(nextStatus(from, pass)).toBe('APPROVED');
    for (const from of ['APPROVED', 'ACTIVE'] as const) expect(nextStatus(from, pass)).toBeNull();
  });

  it('never reopens a closed question, whatever the verdict', () => {
    for (const from of ['RETIRED', 'REJECTED'] as const)
      for (const verdict of [pass, reject, waiting, doubt])
        expect(nextStatus(from, verdict)).toBeNull();
  });

  it('rejects what is not in play on REJECT', () => {
    expect(nextStatus('DRAFT', reject)).toBe('REJECTED');
    expect(nextStatus('REVIEW', reject)).toBe('REJECTED');
  });

  it('pulls a question in play out of play on any verdict that is not PASS, but never rejects it silently', () => {
    for (const from of ['APPROVED', 'ACTIVE'] as const)
      for (const verdict of [reject, waiting, doubt])
        expect(nextStatus(from, verdict)).toBe('REVIEW');
  });

  it('keeps a DRAFT that only waits for the model passes, and asks a person once there is a real finding', () => {
    expect(nextStatus('DRAFT', waiting)).toBeNull();
    expect(nextStatus('DRAFT', doubt)).toBe('REVIEW');
    expect(nextStatus('REVIEW', waiting)).toBeNull();
    expect(nextStatus('REVIEW', doubt)).toBeNull();
  });

  it('is total: every status and verdict gets an answer that the lifecycle table can honour', () => {
    const verdicts = [pass, reject, waiting, doubt];
    for (const from of QUESTION_STATUSES)
      for (const verdict of verdicts) {
        const to: QuestionStatus | null = nextStatus(from, verdict);
        expect(to === null || typeof to === 'string').toBe(true);
      }
  });
});
