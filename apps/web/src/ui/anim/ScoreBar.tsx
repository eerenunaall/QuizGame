import styles from './ScoreBar.module.css';

/** Share of the leader's score (0..1) that a bar shows; an empty board draws no bar. */
export function barFraction(score: number, top: number): number {
  return top <= 0 ? 0 : Math.min(1, Math.max(0, score / top));
}

interface Props {
  /** Fill before the update (0..1). */
  from: number;
  /** Fill after the update (0..1). */
  to: number;
  /** Stagger between rows, ms. */
  delayMs?: number;
  /** The leader's bar is white-gold. */
  leader?: boolean;
  /** The player's own colour tints their bar (any CSS colour). */
  color?: string | undefined;
}

/**
 * The score as a bar behind a score row: it grows from the old share to the new one with an ease-out
 * that overshoots slightly, so a big gain visibly "pushes" past the rows above. A transform on a
 * clipped layer: no layout, no paint per frame (the layer slides in from the left, so its coloured tip
 * keeps its width). The row must be `position: relative; isolation: isolate`.
 */
export function ScoreBar({ from, to, delayMs = 0, leader, color }: Props) {
  return (
    <span className={`${styles.clip} qp-deco`} aria-hidden="true" data-testid="score-bar">
      <span
        className={leader ? `${styles.fill} ${styles.leader}` : styles.fill}
        style={{
          transform: `translateX(${(to - 1) * 100}%)`,
          ['--qp-from' as string]: from,
          ['--qp-to' as string]: to,
          animationDelay: `${delayMs}ms`,
          ...(color ? { ['--qp-bar-color' as string]: color } : {}),
        }}
      />
    </span>
  );
}
