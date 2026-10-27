import { THEMES, isThemeId, type ThemeId } from '@quizparty/ui-tokens';
import type { KeyValueStorage } from '@quizparty/controller-client';
import { setConfettiColors } from './confetti';
import { loadPreferences, savePreferences } from './storage';

export interface ThemeEnv {
  VITE_DEFAULT_THEME?: string | undefined;
  VITE_VENUE_LOGO_URL?: string | undefined;
  VITE_VENUE_NAME?: string | undefined;
  VITE_VENUE_CREDIT?: string | undefined;
}

/**
 * Chooses the theme: `?theme=` (a venue can bookmark `/tv?theme=venue-gold`) beats the saved
 * choice, which beats the deployment default (VITE_DEFAULT_THEME), which beats `party`.
 */
export function pickTheme(search: string, storage: KeyValueStorage, env: ThemeEnv = {}): ThemeId {
  const fromQuery = new URLSearchParams(search).get('theme');
  if (isThemeId(fromQuery)) return fromQuery;
  const saved = loadPreferences(storage).theme;
  if (saved) return saved;
  return isThemeId(env.VITE_DEFAULT_THEME) ? env.VITE_DEFAULT_THEME : 'party';
}

/** Does the URL carry a valid override that should also be remembered for this device? */
export const themeFromQuery = (search: string): ThemeId | null => {
  const value = new URLSearchParams(search).get('theme');
  return isThemeId(value) ? value : null;
};

/** Sets `data-theme`, the browser-chrome colour and the confetti palette. Never throws. */
export function applyTheme(doc: Document, id: ThemeId): void {
  doc.documentElement.dataset.theme = id;
  const theme = THEMES[id];
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.chrome);
  setConfettiColors(theme.confetti);
}

export function saveTheme(storage: KeyValueStorage, id: ThemeId): void {
  savePreferences(storage, { ...loadPreferences(storage), theme: id });
}

/** Accepts only a same-origin path or https URL to an image; anything else means "no logo". */
export function resolveVenueLogo(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  // A backslash after the first slash reads as "//" in browsers (host switch) and `user@` is a
  // credential/host trick: neither belongs in a logo address (ATTACK 30).
  if (!/^(\/(?!\/|\\)|https:\/\/)[^\s"'<>\\@]+\.(svg|png|webp)$/iu.test(value)) return null;
  return value;
}

export interface VenueInfo {
  name: string;
  credit: string;
}

/** Defaults for the Gusto Board Game Cafe deployment, used only when the env sets neither line. */
const GUSTO_VENUE: VenueInfo = { name: 'Gusto Board Game', credit: 'by Eren Ünal' };
const MAX_CREDIT = 60;

/**
 * The credit under the wordmark on the TV title: env wins, empty means hidden, except that the gusto
 * theme falls back to its own venue when nothing is configured. Plain text only (React escapes it).
 */
export function resolveVenueInfo(theme: ThemeId, env: ThemeEnv = {}): VenueInfo | null {
  const name = (env.VITE_VENUE_NAME ?? '').trim().slice(0, MAX_CREDIT);
  const credit = (env.VITE_VENUE_CREDIT ?? '').trim().slice(0, MAX_CREDIT);
  if (name || credit) return { name, credit };
  return theme === 'gusto' ? GUSTO_VENUE : null;
}
