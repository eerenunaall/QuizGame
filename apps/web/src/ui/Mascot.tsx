import { brandSize, brandUrl } from '../lib/brand';
import styles from './Mascot.module.css';
import { cx } from '../lib/cx';

interface Props {
  /** Height in px. */
  height?: number;
  /** `idle` bobs and sways; `cheer` jumps (use when somebody wins or answers right). */
  mood?: 'idle' | 'cheer';
  className?: string;
}

/** The party-cone mascot. Decorative: its meaning is always carried by text next to it. */
export function Mascot({ height = 420, mood = 'idle', className }: Props) {
  const size = brandSize('mascot');
  return (
    <img
      className={cx(
        styles.mascot,
        mood === 'cheer' ? styles.cheer : styles.idle,
        'qp-deco',
        className,
      )}
      src={brandUrl('mascot')}
      width={Math.round((height * size.width) / size.height)}
      height={height}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-mood={mood}
    />
  );
}
