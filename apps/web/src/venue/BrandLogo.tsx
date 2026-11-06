import type { RoomView } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import { VenueLogo } from '../ui/VenueLogo';

/**
 * The logo on a screen. A café table shows its own venue's logo, or none: the deployment's bundled or
 * configured logo is only for rooms that are not a venue table, so one café's mark never appears on
 * another's TV (ADR-0030 §3).
 */
export function BrandLogo({ room, className }: { room: RoomView; className?: string }) {
  const { t } = useI18n();
  const look = room.venue?.look;
  const logo = room.venue?.branding?.logo;
  if (look)
    return logo ? (
      <img className={className} src={logo} alt={look.name || t('theme.logo.alt')} />
    ) : null;
  return <VenueLogo {...(className ? { className } : {})} />;
}
