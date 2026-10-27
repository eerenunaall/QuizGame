import styles from './PhaseSweep.module.css';

/**
 * A soft band of light that crosses the stage when a phase begins, tying the whole TV together as
 * one show. Re-keyed by `phase`, so the CSS animation restarts on every change (and plays once on
 * the first paint, which doubles as the page-load entrance). Decorative: off on low-power TVs.
 */
export function PhaseSweep({ phase }: { phase: string }) {
  return (
    <div key={phase} className={`${styles.sweep} qp-deco`} aria-hidden="true" data-phase={phase}>
      <span className={styles.band} />
      <span className={styles.edge} />
    </div>
  );
}
