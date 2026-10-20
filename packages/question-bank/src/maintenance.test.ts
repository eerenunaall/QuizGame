import { describe, expect, it } from 'vitest';
import { DEFAULT_MAINTENANCE, telemetryVerdict, type TelemetrySample } from './maintenance';

const sample = (answers: number, correct: number, wrongPicks: number[] = []): TelemetrySample => ({
  answers,
  correct,
  options: [
    { picks: correct, correct: true },
    ...wrongPicks.map((picks) => ({ picks, correct: false })),
  ],
});

describe("does a question's answer history look healthy?", () => {
  it('waits for enough answers before judging anything', () => {
    expect(telemetryVerdict(sample(DEFAULT_MAINTENANCE.minAnswers - 1, 0))).toBeNull();
    expect(telemetryVerdict(sample(DEFAULT_MAINTENANCE.minAnswers, 0))).toMatchObject({
      reason: 'LOW_CORRECT_RATE',
    });
  });

  it('flags a question almost nobody gets right, and one everybody gets right', () => {
    expect(telemetryVerdict(sample(100, 9))).toMatchObject({
      reason: 'LOW_CORRECT_RATE',
      detail: { rate: 0.09, answers: 100 },
    });
    expect(telemetryVerdict(sample(100, 10))).toBeNull();
    expect(telemetryVerdict(sample(100, 98))).toBeNull();
    expect(telemetryVerdict(sample(100, 99))).toMatchObject({
      reason: 'HIGH_CORRECT_RATE',
      detail: { rate: 0.99 },
    });
  });

  it('flags a wrong option that a clear majority picks: it may be a second right answer', () => {
    expect(telemetryVerdict(sample(100, 20, [59, 11, 10]))).toBeNull();
    expect(telemetryVerdict(sample(100, 20, [60, 10, 10]))).toMatchObject({
      reason: 'DOMINANT_WRONG_OPTION',
      detail: { share: 0.6 },
    });
    expect(telemetryVerdict(sample(100, 20, [10, 10, 60]))).toMatchObject({
      reason: 'DOMINANT_WRONG_OPTION',
    });
  });

  it('is not fooled by the right option being popular', () => {
    expect(telemetryVerdict(sample(100, 70, [10, 10, 10]))).toBeNull();
  });

  it('takes its thresholds from the configuration', () => {
    expect(
      telemetryVerdict(sample(30, 0), { ...DEFAULT_MAINTENANCE, minAnswers: 30 }),
    ).toMatchObject({ reason: 'LOW_CORRECT_RATE' });
    expect(
      telemetryVerdict(sample(100, 40), { ...DEFAULT_MAINTENANCE, lowCorrectRate: 0.5 }),
    ).toMatchObject({ reason: 'LOW_CORRECT_RATE' });
    expect(
      telemetryVerdict(sample(100, 90), { ...DEFAULT_MAINTENANCE, highCorrectRate: 0.85 }),
    ).toMatchObject({ reason: 'HIGH_CORRECT_RATE' });
  });

  it('copes with a question without any wrong option recorded', () => {
    expect(telemetryVerdict({ answers: 100, correct: 50, options: [] })).toBeNull();
  });
});
