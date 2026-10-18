import { Sticker } from './Sticker';
import type { StickerId } from '../lib/assets';
import styles from './Backdrop.module.css';
import { cx } from '../lib/cx';

export type BackdropTheme = 'lobby' | 'game' | 'final' | 'results';

interface Floater {
  id: StickerId;
  x: number;
  y: number;
  size: number;
  tilt: number;
  delay: number;
}

const FLOATERS: Record<BackdropTheme, Floater[]> = {
  lobby: [
    { id: 'party-popper', x: 1.5, y: 1, size: 120, tilt: -10, delay: 0 },
    { id: 'star', x: 95, y: 22, size: 96, tilt: 12, delay: 1.4 },
    { id: 'balloon', x: 94.5, y: 68, size: 120, tilt: 8, delay: 0.6 },
    { id: 'sparkles', x: 35, y: 88, size: 96, tilt: -6, delay: 2.1 },
  ],
  game: [
    { id: 'light-bulb', x: 2, y: 86, size: 96, tilt: -8, delay: 0.4 },
    { id: 'brain', x: 95, y: 86, size: 96, tilt: 8, delay: 1.2 },
    { id: 'glowing-star', x: 94.5, y: 15, size: 80, tilt: 10, delay: 2 },
  ],
  final: [
    { id: 'fire', x: 3, y: 70, size: 190, tilt: -6, delay: 0 },
    { id: 'fire', x: 92, y: 70, size: 190, tilt: 6, delay: 0.7 },
    { id: 'bolt', x: 12, y: 12, size: 120, tilt: -14, delay: 1.1 },
    { id: 'bolt', x: 86, y: 14, size: 120, tilt: 14, delay: 1.7 },
  ],
  results: [
    { id: 'sparkles', x: 2, y: 80, size: 100, tilt: -8, delay: 0 },
    { id: 'confetti-ball', x: 93, y: 78, size: 120, tilt: 8, delay: 0.8 },
    { id: 'gem', x: 91, y: 12, size: 100, tilt: 12, delay: 1.5 },
    { id: 'crown', x: 4, y: 12, size: 110, tilt: -12, delay: 2.2 },
  ],
};

/** Deterministic pseudo-random star field (same on every render and every device). */
export function starField(count: number): { x: number; y: number; size: number; delay: number }[] {
  const out: { x: number; y: number; size: number; delay: number }[] = [];
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < count; i++)
    out.push({ x: next() * 100, y: next() * 100, size: 3 + next() * 5, delay: next() * 6 });
  return out;
}

const STARS = starField(34);

/** Animated stage dressing: light beams, twinkling stars and a few floating stickers. */
export function Backdrop({ theme = 'lobby' }: { theme?: BackdropTheme }) {
  return (
    <div className={cx(styles.backdrop, styles[theme], 'qp-deco')} aria-hidden="true">
      <div className={styles.beamLeft} />
      <div className={styles.beamRight} />
      <div className={styles.glow} />
      {STARS.map((star, index) => (
        <span
          key={index}
          className={styles.star}
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
      {FLOATERS[theme].map((floater, index) => (
        <span
          key={index}
          className={styles.floater}
          style={{
            left: `${floater.x}%`,
            top: `${floater.y}%`,
            ['--qp-tilt' as string]: `${floater.tilt}deg`,
            animationDelay: `${floater.delay}s`,
          }}
        >
          <Sticker id={floater.id} size={floater.size} />
        </span>
      ))}
    </div>
  );
}
