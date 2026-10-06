import { Sticker } from './Sticker';
import styles from './Wordmark.module.css';
import { cx } from '../lib/cx';

interface Props {
  tagline?: string;
  /** Scale factor (1 = 560 px wide). */
  scale?: number;
}

/** Original wordmark: chunky gold/white lettering, a star and a party popper. */
export function Wordmark({ tagline, scale = 1 }: Props) {
  return (
    <div
      className={styles.wordmark}
      style={{ transform: `scale(${scale})` }}
      role="img"
      aria-label="Quiz Party"
    >
      <Sticker id="star" size={86} className={cx(styles.starLeft, 'qp-deco')} float />
      <Sticker id="party-popper" size={104} className={cx(styles.popper, 'qp-deco')} float />
      <div className={cx(styles.word, styles.quiz)} data-text="QUIZ" aria-hidden="true">
        <span>QUIZ</span>
      </div>
      <div className={cx(styles.word, styles.party)} data-text="PARTY" aria-hidden="true">
        <span>PARTY</span>
      </div>
      {tagline ? <div className={styles.tagline}>{tagline}</div> : null}
    </div>
  );
}
