import type { QuestionLanguage } from './enums';

/**
 * Text normalisation for the question bank (ADR-0014). Two layers:
 *  - `cleanText` produces the canonical *stored* text: composed Unicode, one kind of apostrophe,
 *    no invisible or control characters, single spaces. It never changes a letter.
 *  - `foldKey` produces a *comparison* key: language-aware case folding (Turkish İ/I/ı/i), no
 *    diacritics, no punctuation. Two strings a person would call "the same question" share a key.
 */

/** Soft hyphen, zero-width characters, bidi controls, word joiners, BOM. */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
/** ‘ ’ ʼ ´ → ' (Turkish suffixes are written after an apostrophe, so one form matters). */
const APOSTROPHES = /[‘’ʼ´]/gu;
const WHITESPACE = /[\t\r\n\f\v\p{Zs}\p{Zl}\p{Zp}]+/gu;
const CONTROL = /[\p{Cc}\p{Cs}\p{Co}\p{Cn}]/gu;

export function cleanText(input: string): string {
  return input
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(APOSTROPHES, "'")
    .replace(WHITESPACE, ' ')
    .replace(CONTROL, '')
    .replace(/ {2,}/gu, ' ')
    .trim();
}

/**
 * Lower-case with the language's rules. JavaScript's default turns `İ` into `i` plus a combining
 * dot and `I` into `i`, which merges "IRAK" and "ırak" wrongly for Turkish; handle both letters
 * explicitly first (`İ → i`, `I → ı`).
 */
export function lowerForLanguage(text: string, language: QuestionLanguage): string {
  const prepared = language === 'tr' ? text.replace(/İ/gu, 'i').replace(/I/gu, 'ı') : text;
  return prepared.toLowerCase();
}

/** Letters that survive NFD decomposition and still need an ASCII stand-in for comparison. */
const EXTRA_FOLD: Readonly<Record<string, string>> = {
  ı: 'i',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ł: 'l',
  ð: 'd',
  þ: 'th',
};
const EXTRA_FOLD_PATTERN = /[ıßæœøđłðþ]/gu;

export interface FoldOptions {
  /** `remove`: "Ankara'nın" → "ankaranin" (fingerprints). `split`: → "ankara nin" (token matching). */
  apostrophes?: 'remove' | 'split';
}

export function foldKey(
  text: string,
  language: QuestionLanguage,
  options: FoldOptions = {},
): string {
  const lowered = lowerForLanguage(cleanText(text), language);
  const folded = lowered
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(EXTRA_FOLD_PATTERN, (letter) => EXTRA_FOLD[letter] ?? letter);
  const withoutApostrophes =
    options.apostrophes === 'split' ? folded.replace(/'/gu, ' ') : folded.replace(/'/gu, '');
  return withoutApostrophes
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/ {2,}/gu, ' ')
    .trim();
}

export function tokenize(key: string): string[] {
  return key.length === 0 ? [] : key.split(' ');
}

/** Tokens of the folded text with apostrophe suffixes split off ("Ankara'nın" → ankara, nin). */
export function foldTokens(text: string, language: QuestionLanguage): string[] {
  return tokenize(foldKey(text, language, { apostrophes: 'split' }));
}

/** Words that carry no content in a trivia stem; removing them stops templates from looking alike. */
const STOPWORDS: Readonly<Record<QuestionLanguage, ReadonlySet<string>>> = {
  tr: new Set(
    [
      'hangi',
      'hangisi',
      'hangisidir',
      'hangileri',
      'nedir',
      'neresidir',
      'nerede',
      'nereye',
      'nereden',
      'kimdir',
      'kimin',
      'kim',
      'kimi',
      'kac',
      'kactir',
      'ne',
      'nasil',
      'neden',
      'asagidakilerden',
      'asagidaki',
      'bu',
      'su',
      'o',
      'bir',
      've',
      'ile',
      'icin',
      'de',
      'da',
      'mi',
      'mu',
      'olan',
      'olarak',
      'oldugu',
      'dir',
      'dur',
      'tir',
      'tur',
      'ise',
      'gibi',
      'kadar',
      'daha',
      'en',
      'cok',
      'sonra',
      'once',
      'nin',
      'nun',
      'in',
      'un',
      'da',
      'de',
      'ta',
      'te',
      'ya',
      'ye',
    ].map((word) => foldKey(word, 'tr')),
  ),
  en: new Set([
    'which',
    'what',
    'who',
    'whom',
    'whose',
    'where',
    'when',
    'how',
    'why',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'the',
    'a',
    'an',
    'of',
    'in',
    'on',
    'at',
    'to',
    'for',
    'by',
    'with',
    'from',
    'and',
    'or',
    'as',
    'that',
    'this',
    'these',
    'those',
    'does',
    'did',
    'do',
    'following',
    's',
  ]),
};

export function contentTokens(text: string, language: QuestionLanguage): string[] {
  const stop = STOPWORDS[language];
  return foldTokens(text, language).filter((token) => !stop.has(token));
}

export function isStopword(token: string, language: QuestionLanguage): boolean {
  return STOPWORDS[language].has(token);
}
