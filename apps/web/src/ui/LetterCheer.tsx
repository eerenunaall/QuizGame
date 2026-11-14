import { LETTER_IDS, brandSize, brandUrl } from '../lib/brand';
import styles from './LetterCheer.module.css';
import { cx } from '../lib/cx';

interface Props {
  /** Picks the character; the same seed always gives the same letter (a different one each question). */
  seed: string;
  /** Height in px. */
  height?: number;
  className?: string;
}

/** One of the QuizNight letter characters, hopping in to cheer a right answer. Decorative. */
export function LetterCheer({ seed, height = 120, className }: Props) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1)
    hash = (hash * 31 + seed.charCodeAt(index)) % 100003;
  const id = LETTER_IDS[hash % LETTER_IDS.length]!;
  const size = brandSize(id);
  return (
    <img
      className={cx(styles.cheer, 'qp-deco', className)}
      src={brandUrl(id)}
      width={Math.round((height * size.width) / size.height)}
      height={height}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-letter={id}
    />
  );
}
