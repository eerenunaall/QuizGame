import { containsProfanity } from './profanity';
import { skeleton } from './fold';

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;
const MAX_RAW_LENGTH = 64;
const MAX_EMOJI = 2;
const MAX_COMBINING_RUN = 2;

export type NicknameRejection =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'FORBIDDEN_CHARACTER'
  | 'MIXED_SCRIPT'
  | 'TOO_MANY_EMOJI'
  | 'PROFANITY'
  | 'RESERVED';

export type NicknameResult =
  { ok: true; nickname: string; key: string } | { ok: false; reason: NicknameRejection };

/** Names nobody may take: they impersonate the game, the host or staff (compared by skeleton). */
const RESERVED = [
  'admin',
  'administrator',
  'moderator',
  'server',
  'system',
  'host',
  'quizparty',
  'quizpartyofficial',
  'support',
  'staff',
  'host',
  'moderatör',
  'yönetici',
  'sistem',
  'sunucu',
  'yonetici',
  'moderator',
].map(skeleton);

const SCRIPTS = [
  'Latin',
  'Cyrillic',
  'Greek',
  'Arabic',
  'Hebrew',
  'Han',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Thai',
  'Devanagari',
] as const;
const scriptTests = SCRIPTS.map((name) => ({ name, re: new RegExp(`\\p{Script=${name}}`, 'u') }));

function graphemes(text: string): string[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        l?: string,
        o?: { granularity: 'grapheme' },
      ) => { segment(t: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (Segmenter)
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (s) => s.segment,
    );
  return [...text];
}

/**
 * Validates and normalizes a player nickname (ADR-0009). Returns the cleaned display name and a
 * folded `key` used for per-room uniqueness. Rejects control/format/bidi/zero-width characters,
 * mixed scripts (homoglyph attacks), reserved names and profanity.
 */
export function validateNickname(raw: unknown): NicknameResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'EMPTY' };
  if (raw.length > MAX_RAW_LENGTH) return { ok: false, reason: 'TOO_LONG' };

  const normalized = raw.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) return { ok: false, reason: 'EMPTY' };

  // Control, format (zero-width, bidi overrides), separators other than a plain space, private use,
  // surrogates and unassigned code points are never allowed.
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u.test(normalized))
    return { ok: false, reason: 'FORBIDDEN_CHARACTER' };
  if (/\p{Zs}/u.test(normalized.replace(/ /g, '')))
    return { ok: false, reason: 'FORBIDDEN_CHARACTER' };

  let emoji = 0;
  let combiningRun = 0;
  const scripts = new Set<string>();
  for (const char of normalized) {
    if (/\p{Extended_Pictographic}/u.test(char)) {
      emoji += 1;
      combiningRun = 0;
      continue;
    }
    if (/\p{M}/u.test(char)) {
      combiningRun += 1;
      if (combiningRun > MAX_COMBINING_RUN) return { ok: false, reason: 'FORBIDDEN_CHARACTER' };
      continue;
    }
    combiningRun = 0;
    if (/\p{L}/u.test(char)) {
      const script = scriptTests.find((entry) => entry.re.test(char));
      if (!script) return { ok: false, reason: 'FORBIDDEN_CHARACTER' };
      scripts.add(script.name);
    } else if (!/[\p{N} _\-.]/u.test(char)) {
      return { ok: false, reason: 'FORBIDDEN_CHARACTER' };
    }
  }
  if (emoji > MAX_EMOJI) return { ok: false, reason: 'TOO_MANY_EMOJI' };
  if (scripts.size > 1) return { ok: false, reason: 'MIXED_SCRIPT' };

  const length = graphemes(normalized).length;
  if (length < NICKNAME_MIN_LENGTH) return { ok: false, reason: 'TOO_SHORT' };
  if (length > NICKNAME_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };

  const key = skeleton(normalized);
  if (key.length === 0) return { ok: false, reason: 'EMPTY' };
  if (RESERVED.includes(key)) return { ok: false, reason: 'RESERVED' };
  if (containsProfanity(normalized, { strict: true })) return { ok: false, reason: 'PROFANITY' };
  return { ok: true, nickname: normalized, key };
}
