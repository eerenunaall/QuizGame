import { useId } from 'react';
import { cx } from '../../lib/cx';
import styles from './StreakFlame.module.css';

/** A streak is worth showing from the second answer in a row. */
export const FLAME_FROM = 2;

/** Heat of the flame: 1 warm (2-3), 2 hot (4-5), 3 white-hot (6+). */
export function flameLevel(streak: number): 0 | 1 | 2 | 3 {
  if (streak < FLAME_FROM) return 0;
  if (streak < 4) return 1;
  if (streak < 6) return 2;
  return 3;
}

interface Props {
  streak: number;
  /** Height in px; the flame is 3:4. */
  size?: number;
  className?: string;
  /** Announced by screen readers; the picture itself is decorative. */
  label?: string;
}

/**
 * A little flame with the streak number in its belly. Pure SVG + transform/opacity flicker; the
 * flicker is a decoration (`qp-deco`), so weak TVs and reduced-motion users get a still flame.
 */
export function StreakFlame({ streak, size = 48, className, label }: Props) {
  const level = flameLevel(streak);
  const id = useId().replace(/:/gu, '');
  if (level === 0) return null;
  const width = Math.round(size * 0.78);
  return (
    <span
      className={cx(styles.flame, styles[`lvl${level}`], className)}
      style={{ width, height: size, fontSize: Math.round(size * 0.4) }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-streak={streak}
      data-testid="streak-flame"
    >
      <svg className={cx(styles.svg, 'qp-deco')} viewBox="0 0 48 62" width={width} height={size}>
        <defs>
          <linearGradient id={`${id}o`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="var(--flame-outer-a)" />
            <stop offset="1" stopColor="var(--flame-outer-b)" />
          </linearGradient>
          <linearGradient id={`${id}i`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="var(--flame-inner-a)" />
            <stop offset="1" stopColor="var(--flame-inner-b)" />
          </linearGradient>
        </defs>
        <path
          className={styles.outer}
          fill={`url(#${id}o)`}
          d="M24 1C27 12 43 20 43 39C43 52 35 61 24 61C13 61 5 52 5 39C5 30 10 24 15 17C16 23 18 26 21 27C19 17 20 8 24 1Z"
        />
        <path
          className={styles.inner}
          fill={`url(#${id}i)`}
          d="M24 24C26 31 34 35 34 45C34 53 29 59 24 59C19 59 14 53 14 45C14 40 17 37 19 33C20 36 21 38 23 38C22 33 22 28 24 24Z"
        />
      </svg>
      <span className={styles.count}>{streak}</span>
    </span>
  );
}
