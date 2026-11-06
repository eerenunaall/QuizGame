import { useEffect } from 'react';
import type { RoomView } from '@quizparty/protocol';
import { ACCENTS, accentVariables, isAccentId, isThemeId } from '@quizparty/ui-tokens';
import { applyTheme } from '../lib/theme';

type Look = NonNullable<NonNullable<RoomView['venue']>['look']>;

const ACCENT_PROPS = [
  '--qp-color-accent-a',
  '--qp-color-accent-a-hi',
  '--qp-color-accent-a-lo',
  '--qp-color-accent-a-edge',
  '--qp-gradient-gold',
] as const;

/**
 * Dresses the page with a venue's own look (ADR-0030 §3): its theme and, when it picked one, its accent
 * from the closed palette. Pure DOM work so the panel preview and the screens share it.
 */
export function applyVenueLook(
  doc: Document,
  look: { theme: Look['theme']; accent?: Look['accent'] | null },
): void {
  if (isThemeId(look.theme)) applyTheme(doc, look.theme);
  const style = doc.documentElement.style;
  if (look.accent && isAccentId(look.accent) && look.accent in ACCENTS) {
    for (const [name, value] of Object.entries(accentVariables(look.accent)))
      style.setProperty(name, value);
  } else {
    for (const name of ACCENT_PROPS) style.removeProperty(name);
  }
}

/** The TV and phones at a café table take the venue's look; other rooms are left as the device chose. */
export function useVenueLook(room: RoomView | null): void {
  const look = room?.venue?.look;
  const theme = look?.theme;
  const accent = look?.accent;
  useEffect(() => {
    if (theme === undefined) return;
    applyVenueLook(document, { theme, ...(accent ? { accent } : {}) });
  }, [theme, accent]);
}
