import type { RoomView } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import { resolveVenueInfo } from '../lib/theme';
import { useDataTheme } from '../lib/useDataTheme';
import { VenueLogo } from '../ui/VenueLogo';
import { TvEntrance } from './EntranceLine';
import styles from './TvVenueTimeUp.module.css';

/**
 * The TV of a café table whose time is up (or paused): who to ask, which table it is. A table dresses in
 * its own venue's name and logo (ADR-0030 §3); the deployment's theme and env values are only the fallback
 * for a table that carries no look, so one venue's identity never shows on another's screen.
 */
export function TvVenueTimeUp({ room, reason }: { room: RoomView; reason: 'up' | 'paused' }) {
  const { t } = useI18n();
  const theme = useDataTheme();
  const look = room.venue?.look;
  const logo = room.venue?.branding?.logo;
  const venue = look ? { name: look.name } : resolveVenueInfo(theme, import.meta.env);
  return (
    <div className={styles.screen} data-testid="venue-time-up" data-reason={reason}>
      {logo ? (
        <img className={styles.logo} src={logo} alt={t('theme.logo.alt')} />
      ) : look ? null : (
        <VenueLogo className={styles.logo} />
      )}
      {venue?.name ? <div className={styles.venue}>{venue.name}</div> : null}
      <h1 className={styles.title}>
        {reason === 'up' ? t('venue.timeUp.title') : t('venue.paused.title')}
      </h1>
      <p className={styles.body}>
        {reason === 'up' ? t('venue.timeUp.body') : t('venue.paused.body')}
      </p>
      <TvEntrance room={room} />
      <div className={styles.code}>{t('venue.timeUp.code', { code: room.code })}</div>
    </div>
  );
}
