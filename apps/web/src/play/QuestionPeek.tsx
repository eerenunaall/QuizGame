import type { ReactNode } from 'react';
import { Panel } from '../ui/Panel';
import { TvIcon } from '../ui/TvIcon';
import { useI18n } from '../lib/i18n';
import styles from './QuestionPeek.module.css';
import { cx } from '../lib/cx';

interface ToggleProps {
  shown: boolean;
  onToggle: (next: boolean) => void;
}

/**
 * Small "show the question" switch (accessibility, remembered per device). Off by default: the TV is
 * the stage, so the phone does not repeat the question text.
 */
export function PeekToggle({ shown, onToggle }: ToggleProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={cx(styles.toggle, shown && styles.toggleOn)}
      aria-pressed={shown}
      onClick={() => onToggle(!shown)}
      data-testid="peek-toggle"
      data-focusable
    >
      <svg
        className={styles.eye}
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        {shown ? <path d="M4 20L20 4" /> : null}
      </svg>
      <span>{shown ? t('ctl.peek.hide') : t('ctl.peek.show')}</span>
    </button>
  );
}

/** "Look at the TV for the question", with the TV icon: the whole message of the phone while a question runs. */
export function TvHint({ big }: { big?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cx(styles.hint, big && styles.hintBig)} data-testid="ctl-tv-hint">
      <TvIcon size={big ? 96 : 40} className={styles.tv} />
      <span className={styles.hintText}>{t('ctl.tvQuestion')}</span>
    </div>
  );
}

/** The question text in place, only while the player asked for it. */
export function PeekText({ text }: { text: string }) {
  return (
    <Panel className={styles.card} data-testid="peek-text">
      <div className={styles.text}>{text}</div>
    </Panel>
  );
}

interface PeekProps extends ToggleProps {
  text: string;
  /** Buttons that share the row with the toggle (e.g. 50/50). */
  tools?: ReactNode;
  big?: boolean;
}

/** Hint + toggle row + (optionally) the revealed text, as one block. */
export function QuestionPeek({ text, shown, onToggle, tools, big }: PeekProps) {
  // The simple ruleset sends phones no question text (ADR-0026 §6): there is nothing to peek at.
  const hasText = text !== '';
  return (
    <div className={cx(styles.peek, big && styles.peekBig)}>
      <TvHint {...(big ? { big } : {})} />
      <div className={styles.tools}>
        {tools}
        {hasText ? <PeekToggle shown={shown} onToggle={onToggle} /> : null}
      </div>
      {shown && hasText ? <PeekText text={text} /> : null}
    </div>
  );
}
