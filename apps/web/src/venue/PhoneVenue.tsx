import type { RoomView } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import { meterBlocked, useTicker } from './meter';
import styles from './PhoneVenue.module.css';

/**
 * The winner's reward (ADR-0024 §8): the code big enough to show across a counter, what it is, and that
 * it lasts until the venue's midnight (the phone does not know the venue's time zone, so no clock time).
 */
export function PhoneReward({
  reward,
  forTeam = false,
}: {
  reward: { code: string; text: string; expiresAt: number };
  /** Team play (ADR-0026 §8): this phone holds the one code of the winning team. */
  forTeam?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.reward} data-testid="ctl-venue-reward" role="status">
      <div className={styles.rewardTitle}>{t('venue.reward.title')}</div>
      {forTeam ? <div className={styles.hint}>{t('teams.reward.phone')}</div> : null}
      <div className={styles.rewardText}>{reward.text}</div>
      <div
        className={styles.code}
        data-testid="ctl-venue-reward-code"
        aria-label={reward.code.split('').join(' ')}
      >
        {reward.code.slice(0, 4)}-{reward.code.slice(4)}
      </div>
      <div className={styles.hint}>{t('venue.reward.show')}</div>
      <div className={styles.hint}>{t('venue.reward.expires')}</div>
    </div>
  );
}

/** A one-line note on the phone when the table's time is up or paused (the leader's start would be refused). */
export function PhoneVenueNotice({ room, now }: { room: RoomView; now: () => number }) {
  const { t } = useI18n();
  const time = useTicker(now, room.venue !== undefined);
  const blocked = meterBlocked(room.venue, time);
  if (!blocked) return null;
  return (
    <div className={styles.notice} data-testid="ctl-venue-blocked" data-reason={blocked}>
      {blocked === 'up' ? t('error.VENUE_TIME_UP') : t('error.VENUE_PAUSED')}
    </div>
  );
}
