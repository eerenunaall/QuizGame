import type { VenueMeterView } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import { formatLeft, meterLeftMs, meterTone, useTicker } from './meter';
import styles from './VenueChip.module.css';

const wallClock = (): number => Date.now();

/**
 * The table's time left, a quiet chip in the TV's top bar (never over the question): amber from five
 * minutes, red from one, its own look when paused or up.
 */
export function VenueChip({
  venue,
  now = wallClock,
}: {
  venue: VenueMeterView;
  now?: () => number;
}) {
  const { t } = useI18n();
  const time = useTicker(now, true);
  const tone = meterTone(venue, time);
  const text =
    tone === 'up'
      ? t('venue.chip.up')
      : tone === 'paused'
        ? `${t('venue.chip.paused')} · ${formatLeft(meterLeftMs(venue, time))}`
        : formatLeft(meterLeftMs(venue, time));
  return (
    <span className={`${styles.chip} ${styles[tone]}`} data-testid="venue-chip" data-tone={tone}>
      <span className={styles.label}>{t('venue.chip.label')}</span>
      <span className={styles.value}>{text}</span>
    </span>
  );
}
