/** Colour maths shared by the theme red-team tests (WCAG 2.x contrast, CVD simulation, CIE76). */
type Rgb = readonly [number, number, number];

export const parseHex = (hex: string): Rgb => {
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
};

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
const linear = (hex: string): Rgb => parseHex(hex).map(toLinear) as unknown as Rgb;

export function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type Vision = 'normal' | 'deuteranopia' | 'protanopia';

/** Machado, Oliveira & Fernandes (2009) full-severity matrices, applied in linear RGB. */
const MACHADO: Record<Exclude<Vision, 'normal'>, readonly number[]> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
};

/** Linear-light RGB (0..1) as seen under the given vision type. */
export function simulate(hex: string, vision: Vision): Rgb {
  const rgb = linear(hex);
  if (vision === 'normal') return rgb;
  const m = MACHADO[vision];
  const row = (i: number): number =>
    Math.min(1, Math.max(0, m[i * 3]! * rgb[0] + m[i * 3 + 1]! * rgb[1] + m[i * 3 + 2]! * rgb[2]));
  return [row(0), row(1), row(2)];
}

/** CIE L*a*b* (D65) from linear RGB. */
export function toLab([r, g, b]: Rgb): readonly [number, number, number] {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)] as const;
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference between two colours as seen under one vision type. */
export function deltaE(a: string, b: string, vision: Vision): number {
  const [l1, a1, b1] = toLab(simulate(a, vision));
  const [l2, a2, b2] = toLab(simulate(b, vision));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Smallest pairwise deltaE of a palette, with the offending pair. */
export function minPairDistance(
  palette: readonly string[],
  vision: Vision,
): { distance: number; pair: readonly [string, string] } {
  let best = { distance: Infinity, pair: ['', ''] as readonly [string, string] };
  for (let i = 0; i < palette.length; i++)
    for (let j = i + 1; j < palette.length; j++) {
      const distance = deltaE(palette[i]!, palette[j]!, vision);
      if (distance < best.distance) best = { distance, pair: [palette[i]!, palette[j]!] };
    }
  return best;
}

export const toGammaHex = (rgb: Rgb): string =>
  `#${rgb
    .map((c) =>
      Math.round(toGamma(c) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
