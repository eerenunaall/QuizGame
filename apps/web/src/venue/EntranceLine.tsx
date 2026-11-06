import type { RoomView } from '@quizparty/protocol';
import { useI18n } from '../lib/i18n';
import styles from './EntranceLine.module.css';

/**
 * The venue's entrance line (ADR-0030 §2/§3): text the owner typed, shown as is. It never parses or
 * computes anything; it only exists on rooms with an open table.
 */
export function TvEntrance({ room }: { room: RoomView }) {
  const entrance = room.venue?.entrance;
  if (!entrance) return null;
  return <EntranceCard text={entrance.text} {...(entrance.note ? { note: entrance.note } : {})} />;
}

/** The card itself, also drawn by the panel's live preview. */
export function EntranceCard({ text, note }: { text: string; note?: string }) {
  const { t } = useI18n();
  return (
    <div className={styles.tv} data-testid="tv-entrance">
      <div className={styles.tvLabel}>{t('venue.entrance.title')}</div>
      <div className={styles.tvText}>{text}</div>
      {note ? <div className={styles.tvNote}>{note}</div> : null}
    </div>
  );
}

/** One quiet line in the phone lobby. */
export function PhoneEntrance({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const entrance = room.venue?.entrance;
  if (!entrance) return null;
  return (
    <div className={styles.phone} data-testid="ctl-entrance">
      {t('venue.entrance.phone', { text: entrance.text })}
      {entrance.note ? <span className={styles.phoneNote}> · {entrance.note}</span> : null}
    </div>
  );
}
