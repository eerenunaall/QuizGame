import styles from './RollDots.module.css';

/** Three beats that stand in for the drum roll on the phone while the TV builds up to the answer. */
export function RollDots({ untilMs }: { untilMs: number }) {
  return (
    <span
      className={`${styles.dots} qp-deco`}
      aria-hidden="true"
      style={{ ['--qp-until' as string]: `${untilMs}ms` }}
      data-testid="roll-dots"
    >
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );
}
