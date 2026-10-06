import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Sticker } from './Sticker';
import type { StickerId } from '../lib/assets';
import styles from './Button.module.css';
import { cx } from '../lib/cx';

export type ButtonVariant = 'gold' | 'violet' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'md' | 'lg' | 'xl';

interface Props extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  busy?: boolean;
  icon?: StickerId;
  children: ReactNode;
}

/** Chunky, glossy, pressable. Large hit area and a high-contrast focus ring for TV remotes. */
export function Button({
  variant = 'gold',
  size = 'lg',
  block,
  busy,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: Props) {
  const classes = cx(
    styles.button,
    styles[variant],
    styles[size],
    block && styles.block,
    busy && styles.busy,
    className,
  );
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-focusable
    >
      <span className={styles.shine} aria-hidden="true" />
      {icon ? (
        <Sticker
          id={icon}
          size={size === 'xl' ? 52 : size === 'lg' ? 40 : 30}
          className={styles.icon}
        />
      ) : null}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
