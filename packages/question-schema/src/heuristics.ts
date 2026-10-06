import { containsProfanity } from '@quizparty/validation';
import {
  STANDARD_OPTIONS,
  type AuthorType,
  type Difficulty,
  type Pool,
  type QuestionLanguage,
} from './enums';
import { finding, type Finding } from './findings';
import {
  ABSOLUTE_WORDS,
  ALL_OR_NONE,
  ASCII_FOLDED_TURKISH,
  CATEGORY_KEYWORDS,
  FILLER_OPENERS,
  INJECTION_PATTERN,
  MOJIBAKE,
  NEGATIVE_WORDS,
  PLACEHOLDER_PATTERN,
  SENSITIVE_STEMS,
  SLOP_STRONG,
  SLOP_WEAK,
  TEMPORAL_PHRASES,
} from './lexicon';
import { cleanText, foldKey, foldTokens, isStopword, lowerForLanguage } from './text';

/** What the deterministic checks look at. Everything is data: no clock, no database. */
export interface AuditSubject {
  id?: string;
  language: QuestionLanguage;
  category: string;
  difficulty: Difficulty;
  text: string;
  explanation: string | null;
  options: readonly { text: string; correct: boolean }[];
  pool: Pool;
  expiresAt: Date | null;
  lastVerifiedAt: Date | null;
  sourceCount: number;
  authorType: AuthorType;
}

export interface HeuristicConfig {
  stemMinChars: number;
  stemMaxChars: number;
  optionMaxChars: number;
  explanationMaxChars: number;
  /** Correct answer much longer (or shorter) than the distractors. */
  lengthClue: {
    reviewRatio: number;
    reviewDelta: number;
    rejectRatio: number;
    rejectDelta: number;
    shortRatio: number;
    shortDelta: number;
  };
  /** Years this close to today make an EVERGREEN question look like a recent event. */
  recentYears: number;
  currentVerifyMaxAgeDays: number;
  evergreenVerifyMaxAgeDays: number;
  expirySoonDays: number;
  /** Duplicate thresholds are configurable (GDD §9.9). */
  duplicate: { rejectJaccard: number; reviewJaccard: number; reviewCosine: number };
  /** Weak "generated copy" phrases needed before the question is flagged. */
  slopWeakThreshold: number;
  /** Words inside quotation marks that suggest copied text. */
  quoteWords: number;
}

export const DEFAULT_HEURISTIC_CONFIG: HeuristicConfig = {
  stemMinChars: 18,
  stemMaxChars: 220,
  optionMaxChars: 60,
  explanationMaxChars: 220,
  lengthClue: {
    reviewRatio: 1.5,
    reviewDelta: 8,
    rejectRatio: 2.2,
    rejectDelta: 14,
    shortRatio: 2.5,
    shortDelta: 12,
  },
  recentYears: 2,
  currentVerifyMaxAgeDays: 14,
  evergreenVerifyMaxAgeDays: 540,
  expirySoonDays: 7,
  duplicate: { rejectJaccard: 0.85, reviewJaccard: 0.55, reviewCosine: 0.88 },
  slopWeakThreshold: 2,
  quoteWords: 12,
};

export interface HeuristicContext {
  now: Date;
  /** `categories.source_required` of the question's category. */
  sourceRequired: boolean;
  config?: Partial<HeuristicConfig>;
}

export function resolveConfig(partial?: Partial<HeuristicConfig>): HeuristicConfig {
  return { ...DEFAULT_HEURISTIC_CONFIG, ...partial };
}

const DAY_MS = 86_400_000;
const length = (text: string): number => [...text].length;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Edit distance, abandoned early once it exceeds `limit` (only "0 or 1" matters here). */
function withinEdits(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return false;
    previous = current;
  }
  return previous[b.length]! <= limit;
}

/** "1.500 km", "3,5", "42 %" → the number; null for words. Turkish and English separators. */
export function parseNumeric(text: string): number | null {
  const match = /^[~≈]?\s*(-?\d[\d.,\s\u00A0]*)\s*(?:%|[\p{L}²³/°.]+)?\s*$/u.exec(text.trim());
  if (!match) return null;
  let digits = match[1]!.replace(/[\s\u00A0]/gu, '');
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    digits =
      lastComma > lastDot
        ? digits.replace(/\./gu, '').replace(',', '.')
        : digits.replace(/,/gu, '');
  } else if (lastComma >= 0) {
    const after = digits.length - lastComma - 1;
    digits =
      after === 3 && digits.indexOf(',') === lastComma
        ? digits.replace(',', '')
        : digits.replace(/,/gu, '.');
  } else if (lastDot >= 0) {
    const after = digits.length - lastDot - 1;
    digits = after === 3 ? digits.replace(/\./gu, '') : digits;
  }
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

type OptionKind = 'NUMBER' | 'WORDS';

/**
 * Numbers (years and quantities alike: "1923" may be a year or a count, and mixing the two is not
 * the distractor problem) versus words. Mixing numbers with words is.
 */
function kindOf(text: string): OptionKind {
  return parseNumeric(text.trim()) === null ? 'WORDS' : 'NUMBER';
}

interface PreparedOption {
  text: string;
  key: string;
  tokens: string[];
  correct: boolean;
  len: number;
}

interface Prepared {
  subject: AuditSubject;
  language: QuestionLanguage;
  config: HeuristicConfig;
  now: Date;
  stem: string;
  stemLen: number;
  stemTokens: string[];
  stemKey: string;
  options: PreparedOption[];
  correct: PreparedOption | undefined;
  distractors: PreparedOption[];
  fields: { name: string; text: string }[];
}

function prepare(subject: AuditSubject, context: HeuristicContext): Prepared {
  const language = subject.language;
  const options: PreparedOption[] = subject.options.map((option) => ({
    text: option.text,
    // Symbols and punctuation fold to nothing; compare such options as written.
    key: foldKey(option.text, language) || cleanText(option.text),
    tokens: foldTokens(option.text, language),
    correct: option.correct,
    len: length(option.text),
  }));
  const correctOptions = options.filter((option) => option.correct);
  const fields = [
    { name: 'stem', text: subject.text },
    ...subject.options.map((option, index) => ({ name: `option${index}`, text: option.text })),
    ...(subject.explanation ? [{ name: 'explanation', text: subject.explanation }] : []),
  ];
  return {
    subject,
    language,
    config: resolveConfig(context.config),
    now: context.now,
    stem: subject.text,
    stemLen: length(subject.text),
    stemTokens: foldTokens(subject.text, language),
    stemKey: foldKey(subject.text, language, { apostrophes: 'split' }),
    options,
    correct: correctOptions.length === 1 ? correctOptions[0] : undefined,
    distractors: correctOptions.length === 1 ? options.filter((option) => !option.correct) : [],
    fields,
  };
}

// ───────────────────────── structure and answer integrity ─────────────────────────

function structureRules(p: Prepared, out: Finding[]): void {
  const correctCount = p.options.filter((option) => option.correct).length;
  if (correctCount === 0) out.push(finding('NO_CORRECT_OPTION'));
  if (correctCount > 1) out.push(finding('MULTIPLE_CORRECT_OPTIONS', { count: correctCount }));
  if (p.options.length !== STANDARD_OPTIONS)
    out.push(finding('OPTION_COUNT_NONSTANDARD', { count: p.options.length }));

  const seen = new Map<string, number>();
  let duplicate = false;
  for (const option of p.options) {
    seen.set(option.key, (seen.get(option.key) ?? 0) + 1);
    if ((seen.get(option.key) ?? 0) > 1) duplicate = true;
  }
  if (duplicate) out.push(finding('DUPLICATE_OPTIONS'));

  let nearly = false;
  let overlapping = false;
  for (let i = 0; i < p.options.length; i++) {
    for (let j = i + 1; j < p.options.length; j++) {
      const a = p.options[i]!;
      const b = p.options[j]!;
      if (a.key === b.key) continue;
      if (
        a.key.length >= 5 &&
        b.key.length >= 5 &&
        kindOf(a.text) === 'WORDS' &&
        kindOf(b.text) === 'WORDS' &&
        withinEdits(a.key, b.key, 1)
      )
        nearly = true;
      const [small, large] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a];
      const meaningful = small.tokens.filter((token) => !isStopword(token, p.language));
      if (
        meaningful.length > 0 &&
        small.tokens.length < large.tokens.length &&
        small.tokens.every((token) => large.tokens.includes(token))
      )
        overlapping = true;
    }
  }
  if (nearly) out.push(finding('OPTIONS_NEARLY_IDENTICAL'));
  if (overlapping) out.push(finding('OVERLAPPING_OPTIONS'));

  if (p.options.some((option) => ALL_OR_NONE.test(option.key)))
    out.push(finding('ALL_OR_NONE_OPTION'));
}

function stemWords(p: Prepared): { negatives: number; absolute: boolean } {
  const negatives = p.stemTokens.filter((token) => NEGATIVE_WORDS[p.language].has(token)).length;
  const absolute = p.stemTokens.some((token) => ABSOLUTE_WORDS[p.language].has(token));
  return { negatives, absolute };
}

function ambiguityRules(p: Prepared, out: Finding[]): void {
  const { negatives, absolute } = stemWords(p);
  if (negatives >= 2) out.push(finding('DOUBLE_NEGATIVE'));
  else if (negatives === 1) out.push(finding('NEGATIVE_STEM'));
  if (absolute) out.push(finding('ABSOLUTE_CLAIM'));
}

// ───────────────────────── giveaways ─────────────────────────

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let match = true;
    for (let i = 0; i < needle.length; i++)
      if (haystack[start + i] !== needle[i]) {
        match = false;
        break;
      }
    if (match) return true;
  }
  return false;
}

function giveawayRules(p: Prepared, out: Finding[]): void {
  const { correct, distractors } = p;
  if (!correct) return;

  // The answer written in the question.
  const answerTokens = correct.tokens.filter((token) => !isStopword(token, p.language));
  if (answerTokens.length > 0 && answerTokens.join('').length >= 3) {
    if (containsRun(p.stemTokens, answerTokens)) {
      out.push(finding('ANSWER_IN_QUESTION'));
    } else {
      const echoed = answerTokens.some(
        (token) =>
          token.length >= 5 &&
          !distractors.some((option) => option.tokens.includes(token)) &&
          p.stemTokens.some(
            (stemToken) =>
              stemToken === token ||
              (stemToken.startsWith(token) && stemToken.length <= token.length + 5),
          ),
      );
      if (echoed) out.push(finding('ANSWER_STEM_IN_QUESTION'));
    }
  }

  // Length: the right answer should not be the odd one out.
  if (distractors.length >= 2) {
    const others = distractors.map((option) => option.len);
    const longest = Math.max(...others);
    const shortest = Math.min(...others);
    const c = correct.len;
    const rule = p.config.lengthClue;
    if (c >= rule.rejectRatio * longest && c - longest >= rule.rejectDelta) {
      out.push(finding('LENGTH_CLUE_STRONG', { correct: c, longestOther: longest }));
    } else if (
      (c >= rule.reviewRatio * longest && c - longest >= rule.reviewDelta) ||
      (c * rule.shortRatio <= shortest && shortest - c >= rule.shortDelta)
    ) {
      out.push(finding('LENGTH_CLUE', { correct: c, median: median(others) }));
    }
  }

  // Format: a feature only the correct option has (or only the correct option lacks).
  const features: Record<string, (text: string) => boolean> = {
    parentheses: (text) => /[()]/u.test(text),
    quotes: (text) => /["“”]/u.test(text),
    comma: (text) => text.includes(','),
    digit: (text) => /\d/u.test(text) && kindOf(text) === 'WORDS',
    capital: (text) => /^\p{Lu}/u.test(text),
  };
  if (distractors.length >= 3) {
    for (const [name, has] of Object.entries(features)) {
      const correctHas = has(correct.text);
      const others = distractors.filter((option) => has(option.text)).length;
      if ((correctHas && others === 0) || (!correctHas && others === distractors.length)) {
        out.push(finding('FORMAT_CLUE', { feature: name }));
        break;
      }
    }
  }

  // Kind and scale of the options.
  if (p.options.length >= 3) {
    const kinds = p.options.map((option) => kindOf(option.text));
    if (new Set(kinds).size > 1) out.push(finding('OPTION_TYPE_MISMATCH'));
    else if (kinds[0] === 'NUMBER') {
      const values = p.options
        .map((option) => parseNumeric(option.text))
        .filter((value): value is number => value !== null && value > 0)
        .sort((a, b) => a - b);
      if (values.length === p.options.length && values.length >= 3) {
        const top = values[values.length - 1]!;
        const second = values[values.length - 2]!;
        const bottom = values[0]!;
        const next = values[1]!;
        if (top / second >= 50 || next / bottom >= 50) out.push(finding('NUMERIC_SCALE_MISMATCH'));
      }
    }
  }
}

// ───────────────────────── language, typography, style, safety ─────────────────────────

const CONTROL_OR_INVISIBLE =
  /[\p{Cc}\p{Cs}\p{Co}\p{Cn}\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const LINK =
  /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|me|tv|ly|gg|app|xyz|ru|cn|tk|co)\b)/iu;

function typographyKinds(text: string): string[] {
  const kinds: string[] = [];
  if (/\s[?!,;:]|\s\.(?!\.)/u.test(text)) kinds.push('space_before_punctuation');
  if (/[?!]{2,}|,{2,}|;{2,}|\.\.(?!\.)|\.{4,}/u.test(text)) kinds.push('repeated_punctuation');
  if (/[\p{L}][,;][\p{L}]/u.test(text)) kinds.push('missing_space_after_punctuation');
  const opening = (text.match(/\(/gu) ?? []).length;
  const closing = (text.match(/\)/gu) ?? []).length;
  if (opening !== closing) kinds.push('unbalanced_parentheses');
  const straight = (text.match(/"/gu) ?? []).length;
  const curlyOpen = (text.match(/“/gu) ?? []).length;
  const curlyClose = (text.match(/”/gu) ?? []).length;
  if (straight % 2 === 1 || curlyOpen !== curlyClose) kinds.push('unbalanced_quotes');
  if (/''|``/u.test(text)) kinds.push('doubled_apostrophe');
  if (/\(\s|\s\)/u.test(text)) kinds.push('space_inside_parentheses');
  return kinds;
}

function languageRules(p: Prepared, out: Finding[]): void {
  let encoding = false;
  let invalid = false;
  let placeholder = false;
  let injection = false;
  let ascii = false;
  let emoji = false;
  let link = false;
  let profanity = false;
  const kinds = new Set<string>();

  for (const { name, text } of p.fields) {
    if (MOJIBAKE.some((sequence) => text.includes(sequence))) encoding = true;
    if (CONTROL_OR_INVISIBLE.test(text)) invalid = true;
    const folded = foldKey(text, p.language);
    if (PLACEHOLDER_PATTERN.test(folded)) placeholder = true;
    if (INJECTION_PATTERN.test(folded)) injection = true;
    if (EMOJI.test(text)) emoji = true;
    if (LINK.test(text)) link = true;
    if (containsProfanity(text)) profanity = true;
    for (const kind of typographyKinds(text)) kinds.add(kind);
    if (p.language === 'tr') {
      const words = lowerForLanguage(text, 'tr').split(/[^\p{L}\p{N}]+/u);
      if (words.some((word) => ASCII_FOLDED_TURKISH.has(word))) ascii = true;
    }
    if (name === 'stem' && /[\p{L}]/u.test(text)) {
      const letters = [...text].filter((char) => /\p{L}/u.test(char));
      const upper = letters.filter((char) => char !== char.toLowerCase()).length;
      if (letters.length >= 15 && upper / letters.length >= 0.6) kinds.add('__shouting');
    }
  }
  if (p.language === 'tr' && p.stemLen >= 60) {
    const all = p.fields.map((field) => field.text).join(' ');
    if (!/[çğıöşüÇĞİÖŞÜ]/u.test(all)) ascii = true;
  }

  if (encoding) out.push(finding('BROKEN_ENCODING'));
  if (invalid) out.push(finding('INVALID_CHARACTERS'));
  if (placeholder) out.push(finding('PLACEHOLDER_TEXT'));
  if (injection) out.push(finding('PROMPT_INJECTION_SUSPECT'));
  if (profanity) out.push(finding('PROFANITY'));
  if (ascii) out.push(finding('ASCII_FOLDED_TURKISH'));
  if (emoji) out.push(finding('EMOJI_IN_TEXT'));
  if (link) out.push(finding('LINK_IN_TEXT'));
  if (kinds.has('__shouting')) out.push(finding('SHOUTING'));
  kinds.delete('__shouting');
  if (kinds.size > 0) out.push(finding('TYPOGRAPHY', { kinds: [...kinds].sort().join(',') }));

  // Stem form.
  const trimmed = p.stem.trimEnd();
  if (!/[?:…]$|\.\.\.$/u.test(trimmed)) out.push(finding('STEM_MISSING_QUESTION_MARK'));
  const first = [...p.stem][0] ?? '';
  const firstWord = p.stem.split(' ')[0] ?? '';
  if (
    /\p{Ll}/u.test(first) &&
    !/\p{Lu}/u.test(firstWord) // "iPhone", "eBay": a capital later in the word is a brand, not a typo
  )
    out.push(finding('STEM_LOWERCASE_START'));

  const endsWithPeriod = p.options.filter((option) => /\.$/u.test(option.text)).length;
  if (endsWithPeriod > 0 && endsWithPeriod < p.options.length)
    out.push(finding('OPTION_PUNCTUATION_INCONSISTENT'));
}

function styleRules(p: Prepared, out: Finding[]): void {
  const stemKey = foldKey(p.stem, p.language);
  if (p.stemLen < p.config.stemMinChars) out.push(finding('STEM_TOO_SHORT', { length: p.stemLen }));
  if (p.stemLen > p.config.stemMaxChars) out.push(finding('STEM_TOO_LONG', { length: p.stemLen }));
  if (p.options.some((option) => option.len > p.config.optionMaxChars))
    out.push(finding('OPTION_TOO_LONG', { max: Math.max(...p.options.map((o) => o.len)) }));
  if (p.subject.explanation && length(p.subject.explanation) > p.config.explanationMaxChars)
    out.push(finding('EXPLANATION_TOO_LONG', { length: length(p.subject.explanation) }));
  if (
    !p.subject.explanation &&
    (p.subject.difficulty === 'HARD' || p.subject.difficulty === 'EXPERT')
  )
    out.push(finding('MISSING_EXPLANATION'));

  if (
    FILLER_OPENERS[p.language].some(
      (opener) => stemKey === opener || stemKey.startsWith(`${opener} `),
    )
  )
    out.push(finding('CONVERSATIONAL_FILLER'));
  if (/[(（][^)）]*[)）]/u.test(p.stem)) out.push(finding('STEM_PARENTHETICAL'));

  const everything = ` ${p.fields.map((field) => foldKey(field.text, p.language)).join(' ')} `;
  const strong = SLOP_STRONG[p.language].filter((phrase) => everything.includes(` ${phrase} `));
  const weak = SLOP_WEAK[p.language].filter((phrase) => everything.includes(` ${phrase} `));
  const dashes = (p.stem.match(/[—–]/gu) ?? []).length;
  if (strong.length > 0 || weak.length >= p.config.slopWeakThreshold || dashes >= 2)
    out.push(finding('LLM_STYLE_PHRASES', { phrases: strong.length + weak.length + dashes }));

  const quoted = [
    ...p.fields
      .map((field) => field.text)
      .join(' ')
      .matchAll(/["“]([^"”]{10,})["”]/gu),
  ];
  if (quoted.some((match) => match[1]!.trim().split(/\s+/u).length >= p.config.quoteWords))
    out.push(finding('LONG_QUOTE'));

  if (SENSITIVE_STEMS[p.language].some((stem) => everything.includes(` ${stem}`)))
    out.push(finding('SENSITIVE_TOPIC'));
}

// ───────────────────────── freshness, sources, category ─────────────────────────

function yearsIn(text: string): number[] {
  return [...text.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/gu)].map((match) => Number(match[0]));
}

function freshnessRules(p: Prepared, ctx: HeuristicContext, out: Finding[]): void {
  const { subject, config, now } = p;
  const today = now.getTime();
  if (subject.expiresAt && subject.expiresAt.getTime() <= today) out.push(finding('EXPIRED'));
  if (subject.pool === 'CURRENT') {
    if (subject.expiresAt && subject.expiresAt.getTime() > today) {
      const left = (subject.expiresAt.getTime() - today) / DAY_MS;
      if (left <= config.expirySoonDays)
        out.push(finding('EXPIRY_SOON', { days: Math.ceil(left) }));
    }
    const age = subject.lastVerifiedAt
      ? (today - subject.lastVerifiedAt.getTime()) / DAY_MS
      : Infinity;
    if (age > config.currentVerifyMaxAgeDays)
      out.push(
        finding('STALE_VERIFICATION', { days: Number.isFinite(age) ? Math.floor(age) : -1 }),
      );
  } else {
    if (subject.lastVerifiedAt) {
      const age = (today - subject.lastVerifiedAt.getTime()) / DAY_MS;
      if (age > config.evergreenVerifyMaxAgeDays)
        out.push(finding('REVERIFY_DUE', { days: Math.floor(age) }));
    } else out.push(finding('NEVER_VERIFIED'));

    const key = ` ${p.stemKey} `;
    if (TEMPORAL_PHRASES[p.language].some((phrase) => key.includes(` ${phrase} `)))
      out.push(finding('AMBIGUOUS_TEMPORAL'));
    const year = now.getUTCFullYear();
    const years = yearsIn(p.fields.map((field) => field.text).join(' '));
    if (years.some((value) => value >= year - config.recentYears && value <= year + 1))
      out.push(finding('RECENT_EVENT_AS_EVERGREEN'));
  }
  if (ctx.sourceRequired && subject.sourceCount === 0) out.push(finding('SOURCE_REQUIRED_MISSING'));
}

function keywordMatches(key: string, tokens: readonly string[], entry: string): boolean {
  if (entry.includes(' ')) return ` ${key} `.includes(` ${entry} `);
  if (entry.endsWith('*')) {
    const stem = entry.slice(0, -1);
    return tokens.some((token) => token.startsWith(stem));
  }
  return tokens.includes(entry);
}

function categoryRules(p: Prepared, out: Finding[]): void {
  const own = CATEGORY_KEYWORDS[p.subject.category];
  if (!own) return; // "general" and custom categories have no lexicon
  const tokens = [...p.stemTokens, ...(p.correct?.tokens ?? [])];
  const key = tokens.join(' ');
  const hits = (entries: readonly string[]): number =>
    entries.filter((entry) => keywordMatches(key, tokens, entry)).length;
  if (hits(own) > 0) return;
  let best: { category: string; count: number } | null = null;
  for (const [category, entries] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === p.subject.category) continue;
    const count = hits(entries);
    if (count >= 2 && (!best || count > best.count)) best = { category, count };
  }
  if (best) out.push(finding('CATEGORY_MISMATCH_SUSPECT', { suspected: best.category }));
}

/**
 * Runs every deterministic check that needs only the question itself (duplicates are searched
 * separately against an index). The order of findings is stable, so reports and tests are too.
 */
export function runHeuristics(subject: AuditSubject, context: HeuristicContext): Finding[] {
  const p = prepare(subject, context);
  const out: Finding[] = [];
  structureRules(p, out);
  ambiguityRules(p, out);
  giveawayRules(p, out);
  languageRules(p, out);
  styleRules(p, out);
  freshnessRules(p, context, out);
  categoryRules(p, out);
  return out;
}
