import type { ReactNode } from 'react';
import { Spinner } from './Spinner';
import styles from './Banner.module.css';
import { cx } from '../lib/cx';

interface Props {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  busy?: boolean;
  children: ReactNode;
  size?: 'tv' | 'phone';
  testId?: string;
}

/** Connection and status banners ("Reconnecting…"). Always text, never a stack trace. */
export function Banner({ tone = 'info', busy, children, size = 'phone', testId }: Props) {
  return (
    <div
      className={cx(styles.banner, styles[tone], styles[size])}
      role="status"
      aria-live="polite"
      data-testid={testId}
    >
      {busy ? <Spinner size={size === 'tv' ? 34 : 22} /> : null}
      <span>{children}</span>
    </div>
  );
}
