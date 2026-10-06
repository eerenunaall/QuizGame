import { en } from './en';
import { tr, type MessageKey } from './tr';

export type { MessageKey };
export type Locale = 'tr' | 'en';
export type Params = Record<string, string | number>;

export const catalogs: Record<Locale, Record<MessageKey, string>> = { tr, en };
export const DEFAULT_LOCALE: Locale = 'tr';

export function isLocale(value: unknown): value is Locale {
  return value === 'tr' || value === 'en';
}

/** Picks a supported locale from a BCP-47 tag such as `tr-TR` or `en-GB`. */
export function resolveLocale(candidate: string | null | undefined): Locale {
  const base = (candidate ?? '').toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/** CLDR plural category for the locales we ship: Turkish keeps the singular after numerals. */
export function pluralCategory(locale: Locale, count: number): 'one' | 'other' {
  return locale === 'en' && count === 1 ? 'one' : 'other';
}

export function hasKey(key: string): key is MessageKey {
  return key in tr;
}

/**
 * Looks up `key`; when `params.count` is numeric and `${key}_one` / `${key}_other` exist, the right
 * plural form is used. `{name}` placeholders are substituted; unknown placeholders are left as-is.
 */
export function translate(locale: Locale, key: string, params: Params = {}): string {
  const catalog = catalogs[locale];
  let template: string | undefined;
  const lookup = (candidate: string): string | undefined =>
    (catalog as Record<string, string | undefined>)[candidate];
  if (typeof params.count === 'number') {
    template = lookup(`${key}_${pluralCategory(locale, params.count)}`);
  }
  template ??=
    lookup(key) ?? (catalogs[DEFAULT_LOCALE] as Record<string, string | undefined>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export type Translator = (key: MessageKey, params?: Params) => string;

export function createTranslator(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params);
}

/**
 * Locale-aware upper-casing for display text. Never use CSS `text-transform` for Turkish:
 * `i → İ` and `ı → I` only come out right through the locale-aware methods.
 */
export function upper(locale: Locale, text: string): string {
  return text.toLocaleUpperCase(locale === 'tr' ? 'tr-TR' : 'en-US');
}

export function lower(locale: Locale, text: string): string {
  return text.toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US');
}
