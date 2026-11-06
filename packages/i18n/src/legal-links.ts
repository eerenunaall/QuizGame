import type { Locale } from './index';

/**
 * Labels of the links to /privacy, /terms and /support. Kept apart from `legal.ts` so every screen can
 * show the links without loading the full texts (those pages are lazy-loaded).
 */
export const LEGAL_PATHS = { privacy: '/privacy', terms: '/terms', support: '/support' } as const;

export const legalLinks: Record<Locale, Record<keyof typeof LEGAL_PATHS, string>> = {
  tr: { privacy: 'Gizlilik', terms: 'Kullanım koşulları', support: 'Destek' },
  en: { privacy: 'Privacy', terms: 'Terms of use', support: 'Support' },
};
