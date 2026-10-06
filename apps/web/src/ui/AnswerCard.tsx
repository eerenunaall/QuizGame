import type { ReactNode } from 'react';
import { Sticker } from './Sticker';
import styles from './AnswerCard.module.css';
import { cx } from '../lib/cx';

export type AnswerState = 'idle' | 'selected' | 'dim' | 'locked' | 'correct' | 'wrong';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const COLOR_CLASSES = ['a', 'b', 'c', 'd', 'a', 'b'] as const;

interface Props {
  index: number;
  text: string;
  state?: AnswerState;
  /** `tv`: large display card. `phone`: full-width thumb target. */
  size?: 'tv' | 'phone';
  /** Phones make it a button; the TV shows it as a plain card. */
  onSelect?: () => void;
  disabled?: boolean;
  /** Font size override in px (the TV scales long answers down to keep them inside the card). */
  textSize?: number;
  /** Trailing content, e.g. the faces of the players who picked this option. */
  children?: ReactNode;
}

export function AnswerCard({
  index,
  text,
  state = 'idle',
  size = 'tv',
  onSelect,
  disabled,
  textSize,
  children,
}: Props) {
  const letter = LETTERS[index] ?? '?';
  const tone = COLOR_CLASSES[index] ?? 'a';
  const classes = cx(styles.card, styles[tone], styles[size], styles[state]);
  const body = (
    <>
      <span className={styles.badge} aria-hidden="true">
        {letter}
      </span>
      <span className={styles.text} style={textSize ? { fontSize: textSize } : undefined}>
        {text}
      </span>
      {state === 'correct' ? (
        <Sticker id="check" size={size === 'tv' ? 64 : 40} className={styles.mark} />
      ) : null}
      {state === 'wrong' ? (
        <Sticker id="cross" size={size === 'tv' ? 64 : 40} className={styles.mark} />
      ) : null}
      {children}
    </>
  );
  if (onSelect) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onSelect}
        disabled={disabled}
        aria-label={`${letter}: ${text}`}
        aria-pressed={state === 'selected' || state === 'locked'}
        data-answer-index={index}
        data-focusable
      >
        {body}
      </button>
    );
  }
  return (
    <div className={classes} data-answer-index={index}>
      {body}
    </div>
  );
}
