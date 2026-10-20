import type { ReactNode } from 'react';
import { AnswerShape } from './AnswerShape';
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
  /** Third cue besides colour and letter (a shape). On by default for phones; the TV keeps its own look. */
  showShape?: boolean;
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
  showShape = size === 'phone',
}: Props) {
  const letter = LETTERS[index] ?? '?';
  const tone = COLOR_CLASSES[index] ?? 'a';
  // `qp-deco`: the pop is decoration, so low-motion TVs skip it (the state itself still shows).
  const classes = cx(
    styles.card,
    styles[tone],
    styles[size],
    styles[state],
    (state === 'selected' || state === 'correct') && 'qp-deco',
  );
  const body = (
    <>
      <span className={styles.badge} aria-hidden="true">
        {letter}
      </span>
      <span className={styles.text} style={textSize ? { fontSize: textSize } : undefined}>
        {text}
      </span>
      {state === 'locked' ? (
        <Sticker id="lock" size={size === 'tv' ? 64 : 40} className={styles.mark} />
      ) : null}
      {state === 'correct' ? (
        <Sticker id="check" size={size === 'tv' ? 64 : 40} className={styles.mark} />
      ) : null}
      {state === 'wrong' ? (
        <Sticker id="cross" size={size === 'tv' ? 64 : 40} className={styles.mark} />
      ) : null}
      {showShape && state !== 'locked' && state !== 'correct' && state !== 'wrong' ? (
        <span className={styles.shape}>
          <AnswerShape index={index} size={30} />
        </span>
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
