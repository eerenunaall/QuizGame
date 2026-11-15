/**
 * Wrong options for a question from its right answer alone (owner request 2026-11-15: "Bryan Cranston" in,
 * three other names out, the right one at a random place). No model, no key.
 *
 * - A number or a year gets near numbers ("1923" -> 1919, 1925, 1931; "67 metre" -> 61 metre ...), never the
 *   answer itself, never negative when the answer is not.
 * - Anything else gets candidates that look like it (same number of words, similar length, same capital
 *   letters and digits), taken first from the owner's own list, then from other right answers of the same
 *   category (the caller fetches those). Fewer than three usable candidates is reported, not invented.
 *
 * Pure: the caller injects the randomness, so a test (or a replay) is exact.
 */

export interface SuggestInput {
  correct: string;
  /** Right answers of other questions (same category first); only their text matters. */
  candidates: readonly string[];
  /** The owner's own list of wrong answers for this kind of question; preferred over `candidates`. */
  own?: readonly string[];
  random: () => number;
  /** How many wrong options (default 3 = four in all). */
  count?: number;
}

export interface SuggestResult {
  /** The right answer and the wrong ones in a random order. */
  options: string[];
  correctIndex: number;
  kind: 'NUMBER' | 'TEXT';
  /** How many wrong options came from the owner's list. */
  fromOwn: number;
  /** Wrong options that could not be found (the owner types them). */
  missing: number;
}

const MAX_LENGTH = 200;
const TOP = 12;
/** How much less alike than the best candidate a candidate may be and still be drawn. */
const SPREAD = 2.5;

const clean = (text: string): string => text.replace(/\s+/gu, ' ').trim();

const fold = (text: string): string =>
  text
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/gu, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, '');

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function sample<T>(items: readonly T[], n: number, random: () => number): T[] {
  return shuffle([...items], random).slice(0, n);
}

// ───────────── numbers ─────────────

interface Num {
  value: number;
  decimals: number;
  /** Thousands separator of the original ("1.453"), or null. */
  group: boolean;
  unit: string;
}

function parseNumber(text: string): Num | null {
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,3}))?(?:\s*(\S.{0,40}))?$/u.exec(text);
  if (!m) return null;
  const whole = m[1]!;
  const group = whole.includes('.');
  const decimals = m[2]?.length ?? 0;
  const value = Number(`${whole.replace(/\./gu, '')}${m[2] ? `.${m[2]}` : ''}`);
  if (!Number.isFinite(value) || value > 1e12) return null;
  return { value, decimals, group, unit: m[3] ? ` ${m[3]}` : '' };
}

function formatNumber(n: Num, value: number): string {
  const fixed = value.toFixed(n.decimals);
  const [whole = '', frac] = fixed.split('.');
  const grouped = n.group ? whole.replace(/\B(?=(\d{3})+(?!\d))/gu, '.') : whole;
  return `${grouped}${frac ? `,${frac}` : ''}${n.unit}`;
}

/** Plausible neighbours of a number: years stay within a few decades, others within about half their size. */
function nearNumbers(n: Num, random: () => number, count: number): string[] {
  const { value } = n;
  const isYear = n.decimals === 0 && !n.group && n.unit === '' && value >= 1000 && value <= 2100;
  let steps: number[];
  if (isYear) steps = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
  else {
    const base = Math.max(n.decimals > 0 ? 10 ** -n.decimals : 1, magnitudeStep(value));
    steps = [1, 2, 3, 4, 5, 6, 8].map((k) => base * k);
  }
  const wanted = new Set<string>();
  const options: string[] = [];
  const answer = formatNumber(n, value);
  for (const step of shuffle(steps, random)) {
    for (const sign of shuffle([1, -1], random)) {
      const next = value + sign * step;
      if (next < 0 && value >= 0) continue;
      if (isYear && (next < 1 || next > 2100)) continue;
      const text = formatNumber(n, next);
      if (text === answer || wanted.has(text)) continue;
      wanted.add(text);
      options.push(text);
    }
  }
  // Prefer the closer ones (they look like honest alternatives), but not always the same three.
  const close = options.slice(0, Math.max(count * 3, count));
  return sample(close, count, random);
}

/** One tenth of the number, rounded to one significant digit: 1453 -> 100, 67 -> 6 -> 7 (min 1). */
function magnitudeStep(value: number): number {
  const tenth = Math.abs(value) / 10;
  if (tenth < 1) return 1;
  const power = 10 ** Math.floor(Math.log10(tenth));
  return Math.max(1, Math.round(tenth / power) * power);
}

// ───────────── words ─────────────

const words = (text: string): number => text.split(' ').filter(Boolean).length;
const capitals = (text: string): number => (text.match(/\p{Lu}/gu) ?? []).length;
const hasDigit = (text: string): boolean => /\d/u.test(text);

/** Smaller is more alike. */
function distance(correct: string, other: string): number {
  const lengthRatio = Math.abs(Math.log((other.length + 1) / (correct.length + 1)));
  return (
    Math.abs(words(correct) - words(other)) * 2 +
    lengthRatio * 2 +
    (capitals(correct) > 0 === capitals(other) > 0 ? 0 : 2) +
    Math.min(2, Math.abs(capitals(correct) - capitals(other)) * 0.4) +
    (hasDigit(correct) === hasDigit(other) ? 0 : 3)
  );
}

function usable(correct: string, other: string): boolean {
  if (other.length === 0 || other.length > MAX_LENGTH) return false;
  const a = fold(correct);
  const b = fold(other);
  if (!b || a === b) return false;
  // "Ankara" is no wrong answer for "Ankara Kalesi" (and the other way round).
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return false;
  return true;
}

function pick(
  correct: string,
  pool: readonly string[],
  taken: Set<string>,
  count: number,
  random: () => number,
): string[] {
  const unique = new Map<string, string>();
  for (const raw of pool) {
    const text = clean(raw);
    const key = fold(text);
    if (!usable(correct, text) || taken.has(key) || unique.has(key)) continue;
    unique.set(key, text);
  }
  const ranked = [...unique.entries()]
    .map(([key, text]) => ({ key, text, score: distance(correct, text) + random() * 1.5 }))
    .sort((a, b) => a.score - b.score);
  // Only candidates about as alike as the best one are drawn from, so a one-word city never stands in for a
  // two-word name just because the list is short; the jitter above varies the draw between tries.
  const limit = (ranked[0]?.score ?? 0) + SPREAD;
  let eligible = ranked.filter((item) => item.score <= limit).slice(0, TOP);
  if (eligible.length < count) eligible = ranked.slice(0, count);
  const chosen = sample(eligible, count, random);
  for (const item of chosen) taken.add(item.key);
  return chosen.map((item) => item.text);
}

// ───────────── entry point ─────────────

export function suggestOptions(input: SuggestInput): SuggestResult {
  const count = input.count ?? 3;
  const correct = clean(input.correct).slice(0, MAX_LENGTH);
  const number = parseNumber(correct);
  const taken = new Set([fold(correct)]);
  let wrong: string[];
  let fromOwn: number;
  let kind: SuggestResult['kind'];
  if (number) {
    kind = 'NUMBER';
    wrong = nearNumbers(number, input.random, count);
    // A list of numbers the owner prepared still wins over made-up ones.
    const own = pick(correct, input.own ?? [], taken, count, input.random);
    wrong = [...own, ...wrong.filter((w) => !taken.has(fold(w)))].slice(0, count);
    fromOwn = Math.min(own.length, wrong.length);
  } else {
    kind = 'TEXT';
    const own = pick(correct, input.own ?? [], taken, count, input.random);
    fromOwn = own.length;
    const rest = pick(correct, input.candidates, taken, count - own.length, input.random);
    wrong = [...own, ...rest];
  }
  const all = shuffle([correct, ...wrong], input.random);
  return {
    options: all,
    correctIndex: all.indexOf(correct),
    kind,
    fromOwn,
    missing: Math.max(0, count - wrong.length),
  };
}
