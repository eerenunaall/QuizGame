import { StreakFlame } from './StreakFlame';
import { cx } from '../../lib/cx';
import styles from './ComboToast.module.css';

interface Props {
  streak: number;
  /** The words next to the flame ("3 in a row!"); user-visible text lives in packages/i18n. */
  text: string;
  /** A small line above the text, e.g. the name of the player on a streak (TV). */
  label?: string;
  /** Delay before it pops in (ms): the reveal's hit, so it lands after the answer. */
  delayMs?: number;
  /** `tv`: stage pixels; `phone`: smaller. */
  size?: 'tv' | 'phone';
  className?: string;
}

/** The combo badge: a pill with a flame that pops in with a little overshoot and settles. */
export function ComboToast({ streak, text, label, delayMs = 0, size = 'phone', className }: Props) {
  return (
    <div
      className={cx(styles.toast, styles[size], 'qp-deco', className)}
      style={{ ['--qp-delay' as string]: `${delayMs}ms` }}
      role="status"
      data-testid="combo-toast"
      data-streak={streak}
    >
      <StreakFlame streak={streak} size={size === 'tv' ? 60 : 40} />
      <span className={styles.copy}>
        {label ? <span className={styles.label}>{label}</span> : null}
        <span className={styles.text}>{text}</span>
      </span>
    </div>
  );
}

/** Players whose streak just reached `min` with this answer, longest first (the TV shows at most `limit`). */
export function comboPlayers<T extends { streak: number }>(
  entries: readonly T[],
  min = 3,
  limit = 3,
): T[] {
  return entries
    .filter((entry) => entry.streak >= min)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, limit);
}
