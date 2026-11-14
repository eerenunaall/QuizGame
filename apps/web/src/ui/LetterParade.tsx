import { LETTER_IDS, brandSize, brandUrl } from '../lib/brand';
import { BRAND_NAME } from '../lib/config';
import styles from './LetterParade.module.css';

interface Props {
  /** Height of the tallest letter in px. */
  height?: number;
}

/**
 * QuizNight spelled by nine little characters: they hop in one after another and keep bobbing out of
 * step. The row is one image-set to assistive technology (the brand name), not nine pictures.
 */
export function LetterParade({ height = 180 }: Props) {
  return (
    <div className={styles.row} role="img" aria-label={BRAND_NAME}>
      {LETTER_IDS.map((id, index) => {
        const size = brandSize(id);
        return (
          <img
            key={id}
            className={`${styles.letter} qp-deco`}
            style={{ animationDelay: `${index * 90}ms, ${700 + index * 130}ms` }}
            src={brandUrl(id)}
            width={Math.round((height * size.width) / 300)}
            height={Math.round((height * size.height) / 300)}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        );
      })}
    </div>
  );
}
