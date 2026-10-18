import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createTranslator,
  translate,
  upper,
  type Locale,
  type MessageKey,
  type Params,
} from '@quizparty/i18n';

export interface I18n {
  locale: Locale;
  /** Statically checked keys: a typo is a compile error. */
  t: (key: MessageKey, params?: Params) => string;
  /** Keys assembled at run time (`error.${code}`, `game.kind.${kind}`); unknown keys fall back to Turkish. */
  td: (key: string, params?: Params) => string;
  /** Locale-aware upper-casing (never `toUpperCase()` for Turkish: `i → İ`). */
  up: (text: string) => string;
}

const Context = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(
    () => ({
      locale,
      t: createTranslator(locale),
      td: (key, params) => translate(locale, key, params),
      up: (text) => upper(locale, text),
    }),
    [locale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error('I18nProvider is missing');
  return value;
}
