import { useI18n } from '../lib/i18n';
import { resolveVenueLogo } from '../lib/theme';
import { useDataTheme } from '../lib/useDataTheme';

const LOGO_URL = resolveVenueLogo(import.meta.env.VITE_VENUE_LOGO_URL);

// The Gusto round logo is a bundled asset; a missing file just means no logo (the glob is then empty).
const GUSTO_LOGO =
  Object.values(
    import.meta.glob<string>('../assets/brand/gusto-logo.webp', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
  )[0] ?? null;

/** The logo to show for a theme: the env-configured one wins, then the bundled Gusto logo in its theme. */
export const venueLogoFor = (theme: string): string | null =>
  LOGO_URL ?? (theme === 'gusto' ? GUSTO_LOGO : null);

/**
 * Neutral, optional venue-logo slot. Renders nothing until the owner supplies a logo
 * (VITE_VENUE_LOGO_URL, e.g. /venue/logo.svg served from apps/web/public, or the gusto theme's own
 * bundled logo); no logo is invented here.
 */
export function VenueLogo({ className }: { className?: string }) {
  const { t } = useI18n();
  const logo = venueLogoFor(useDataTheme());
  if (!logo) return null;
  return <img className={className} src={logo} alt={t('theme.logo.alt')} />;
}
