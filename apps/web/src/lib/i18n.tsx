import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createTranslator,
  resolveLocale,
  translate,
  upper,
  type Locale,
  type MessageKey,
  type Params,
} from '@quizparty/i18n';
import { loadPreferences } from './storage';
import type { KeyValueStorage } from '@quizparty/controller-client';

export interface I18n {
  locale: Locale;
  /** Statically checked keys: a typo is a compile error. */
  t: (key: MessageKey, params?: Params) => string;
  /** Keys assembled at run time (`error.${code}`, `game.kind.${kind}`); unknown keys fall back to the Turkish text. */
  td: (key: string, params?: Params) => string;
  /** Locale-aware upper-casing (never CSS text-transform: `i → İ`). */
  up: (text: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

/** Chooses the UI language: `?lang=` first, then the saved preference, then the browser. */
export function pickLocale(
  search: string,
  storage: KeyValueStorage,
  navigatorLanguage: string | undefined,
): Locale {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (fromQuery === 'tr' || fromQuery === 'en') return fromQuery;
  const saved = loadPreferences(storage).locale;
  if (saved) return saved;
  return resolveLocale(navigatorLanguage);
}

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const t = createTranslator(locale);
    return {
      locale,
      t,
      td: (key, params) => translate(locale, key, params),
      up: (text) => upper(locale, text),
    };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('I18nProvider is missing');
  return value;
}
