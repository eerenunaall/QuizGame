import styles from './RevealBurst.module.css';

const RAYS = 12;

/** Offsets of one ray: angle in degrees and travel distance in px (deterministic, no randomness). */
export function rayVector(index: number, count = RAYS): { angle: number; distance: number } {
  return { angle: (360 / count) * index, distance: 150 + (index % 3) * 34 };
}

/**
 * Sparkles that fly outward from the centre of the right answer when the drum hits. Pure CSS
 * transform/opacity; decorative, so it is hidden from assistive tech and off on low-power TVs.
 */
export function RevealBurst({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <span
      className={`${styles.burst} qp-deco`}
      aria-hidden="true"
      style={{ ['--qp-delay' as string]: `${delayMs}ms` }}
      data-testid="reveal-burst"
    >
      <span className={styles.flash} />
      {Array.from({ length: RAYS }, (_, index) => {
        const { angle, distance } = rayVector(index);
        return (
          <span
            key={index}
            className={`${styles.ray} ${index % 2 === 0 ? styles.big : styles.small}`}
            style={{
              ['--qp-angle' as string]: `${angle}deg`,
              ['--qp-dist' as string]: `${distance}px`,
            }}
          />
        );
      })}
    </span>
  );
}
