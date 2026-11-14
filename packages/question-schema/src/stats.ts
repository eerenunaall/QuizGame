/**
 * Small statistics helpers for batch checks: is the correct answer position balanced (rubric §5:
 * "correct-answer positions must be statistically balanced")? No dependency: a chi-square survival
 * function via the regularised incomplete gamma function (Numerical Recipes, series and continued
 * fraction), checked against published critical values in the tests.
 */
// Lanczos approximation (g = 7, n = 9): relative error around 1e-15, plenty for p-values.
const LANCZOS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
  12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
];

function lnGamma(x: number): number {
  const z = x - 1;
  let sum = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Regularised upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** P(X ≥ x) for a chi-square variable with `df` degrees of freedom. */
export function chiSquareSurvival(x: number, df: number): number {
  if (x <= 0) return 1;
  return Math.min(1, Math.max(0, gammaQ(df / 2, x / 2)));
}

/** Pearson chi-square statistic of observed counts against equal expected counts. */
export function chiSquareUniform(counts: readonly number[]): { statistic: number; df: number } {
  const total = counts.reduce((sum, value) => sum + value, 0);
  const expected = total / counts.length;
  if (expected === 0) return { statistic: 0, df: counts.length - 1 };
  const statistic = counts.reduce((sum, value) => sum + (value - expected) ** 2 / expected, 0);
  return { statistic, df: counts.length - 1 };
}
