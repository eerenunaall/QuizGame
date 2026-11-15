import { describe, expect, it } from 'vitest';
import { chiSquareSurvival, chiSquareUniform } from './stats';

describe('chiSquareSurvival', () => {
  it('reproduces published critical values', () => {
    const cases: [number, number, number][] = [
      // [statistic, degrees of freedom, upper-tail probability]
      [3.841, 1, 0.05],
      [6.635, 1, 0.01],
      [7.815, 3, 0.05],
      [11.345, 3, 0.01],
      [16.266, 3, 0.001],
      [18.307, 10, 0.05],
      [29.588, 10, 0.001],
    ];
    for (const [statistic, df, expected] of cases)
      expect(chiSquareSurvival(statistic, df)).toBeCloseTo(expected, 3);
  });

  it('is 1 at zero and tends to 0', () => {
    expect(chiSquareSurvival(0, 3)).toBe(1);
    expect(chiSquareSurvival(200, 3)).toBeLessThan(1e-30);
  });
});

describe('chiSquareUniform', () => {
  it('is zero for perfectly even counts and grows with imbalance', () => {
    expect(chiSquareUniform([10, 10, 10, 10]).statistic).toBe(0);
    expect(chiSquareUniform([25, 5, 5, 5]).statistic).toBeGreaterThan(20);
    expect(chiSquareUniform([25, 5, 5, 5]).df).toBe(3);
  });
});
