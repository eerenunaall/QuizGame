import type { RoomView } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import { resolveVenueInfo } from '../lib/theme';
import { useDataTheme } from '../lib/useDataTheme';
import { VenueLogo } from '../ui/VenueLogo';
import styles from './TvVenueTimeUp.module.css';

/**
 * The TV of a café table whose time is up (or paused): who to ask, which table it is. The venue's name
 * and logo come from the deployment's theme, never from the server (ADR-0024 §6).
 */
export function TvVenueTimeUp({ room, reason }: { room: RoomView; reason: 'up' | 'paused' }) {
  const { t } = useI18n();
  const venue = resolveVenueInfo(useDataTheme(), import.meta.env);
  return (
    <div className={styles.screen} data-testid="venue-time-up" data-reason={reason}>
      <VenueLogo className={styles.logo} />
      {venue?.name ? <div className={styles.venue}>{venue.name}</div> : null}
      <h1 className={styles.title}>
        {reason === 'up' ? t('venue.timeUp.title') : t('venue.paused.title')}
      </h1>
      <p className={styles.body}>
        {reason === 'up' ? t('venue.timeUp.body') : t('venue.paused.body')}
      </p>
      <div className={styles.code}>{t('venue.timeUp.code', { code: room.code })}</div>
    </div>
  );
}
