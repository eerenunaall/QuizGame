import { brandSize, brandUrl } from '../lib/brand';
import { BRAND_NAME } from '../lib/config';
import styles from './Wordmark.module.css';
import { cx } from '../lib/cx';

interface Props {
  tagline?: string;
  /** Scale factor (1 = 560 px wide). */
  scale?: number;
}

const WIDTH = 560;

/** The QuizNight logo, popping in once and floating gently afterwards (still on low-power TVs). */
export function Wordmark({ tagline, scale = 1 }: Props) {
  const size = brandSize('logo');
  const height = Math.round((WIDTH * size.height) / size.width);
  return (
    <div className={styles.wordmark} style={{ transform: `scale(${scale})` }}>
      <img
        className={cx(styles.logo, 'qp-deco')}
        src={brandUrl('logo')}
        width={WIDTH}
        height={height}
        alt={BRAND_NAME}
        draggable={false}
      />
      {tagline ? <div className={styles.tagline}>{tagline}</div> : null}
    </div>
  );
}
