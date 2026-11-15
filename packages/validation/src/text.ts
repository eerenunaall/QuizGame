import { containsProfanity } from './profanity';

export type UserTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'EMPTY' | 'TOO_LONG' | 'FORBIDDEN_CHARACTER' | 'PROFANITY' | 'LINK' };

const URL_LIKE =
  /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|me|tv|ly|gg|app|xyz|ru|cn|tk|co)\b)/iu;

/**
 * Letters that draw nothing (Hangul/Khmer fillers, braille blank, combining grapheme joiner …) are
 * not "format" characters, yet between letters they hide words from the profanity and link screens
 * (ATTACK 28). U+FE0F/U+FE0E stay: emoji need them.
 */
const INVISIBLE = /(?![\uFE0E\uFE0F])[\p{Default_Ignorable_Code_Point}\u2800]/u;
/** More than three stacked combining marks only ever paint over the lines around the text. */
const MARK_STACK = /\p{M}{4,}/u;

/**
 * Sanitizes short free text from players (statements, personal answers, custom quiz text):
 * NFKC, no control/format/bidi characters, collapsed whitespace, length cap, no links
 * (malicious links in UGC are a listed abuse case, GDD §37.9), profanity screening.
 */
export function sanitizeUserText(
  raw: unknown,
  options: { maxLength: number; allowLinks?: boolean } = { maxLength: 140 },
): UserTextResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'EMPTY' };
  if (raw.length > options.maxLength * 4) return { ok: false, reason: 'TOO_LONG' };
  const text = raw
    .normalize('NFKC')
    .replace(/[\t\r\n]+/gu, ' ')
    .replace(/ {2,}/gu, ' ')
    .trim();
  if (text.length === 0) return { ok: false, reason: 'EMPTY' };
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u.test(text))
    return { ok: false, reason: 'FORBIDDEN_CHARACTER' };
  if (INVISIBLE.test(text) || MARK_STACK.test(text))
    return { ok: false, reason: 'FORBIDDEN_CHARACTER' };
  if ([...text].length > options.maxLength) return { ok: false, reason: 'TOO_LONG' };
  if (!options.allowLinks && URL_LIKE.test(text)) return { ok: false, reason: 'LINK' };
  if (containsProfanity(text)) return { ok: false, reason: 'PROFANITY' };
  return { ok: true, text };
}
