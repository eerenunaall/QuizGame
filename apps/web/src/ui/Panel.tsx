import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Panel.module.css';
import { cx } from '../lib/cx';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'navy' | 'glass' | 'violet';
  children: ReactNode;
}

export function Panel({ tone = 'navy', className, children, ...rest }: PanelProps) {
  return (
    <div {...rest} className={cx(styles.panel, styles[tone], className)}>
      {children}
    </div>
  );
}

interface PillProps {
  selected?: boolean;
  disabled?: boolean;
  locked?: boolean;
  onClick?: () => void;
  children: ReactNode;
  size?: 'md' | 'lg';
}

/** A selectable choice chip (question count, difficulty …). */
export function Pill({ selected, disabled, locked, onClick, children, size = 'md' }: PillProps) {
  return (
    <button
      type="button"
      className={cx(
        styles.pill,
        styles[`pill-${size}`],
        selected && styles.selected,
        locked && styles.locked,
      )}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected ?? false}
      data-focusable
    >
      {children}
    </button>
  );
}
