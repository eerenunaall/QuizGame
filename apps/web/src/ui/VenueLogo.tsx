import { useI18n } from '../lib/i18n';
import { resolveVenueLogo } from '../lib/theme';

const LOGO_URL = resolveVenueLogo(import.meta.env.VITE_VENUE_LOGO_URL);

/**
 * Neutral, optional venue-logo slot. Renders nothing until the owner supplies an SVG
 * (VITE_VENUE_LOGO_URL, e.g. /venue/logo.svg served from apps/web/public); no logo is invented here.
 */
export function VenueLogo({ className }: { className?: string }) {
  const { t } = useI18n();
  if (!LOGO_URL) return null;
  return <img className={className} src={LOGO_URL} alt={t('theme.logo.alt')} />;
}
