import { avatarUrl } from '../lib/assets';
import { playerColor } from '@quizparty/ui-tokens';
import { Sticker } from './Sticker';
import styles from './Avatar.module.css';
import { cx } from '../lib/cx';

interface Props {
  avatarId: string;
  /** Edge length in px (the crown and ring extend a little beyond it). */
  size?: number;
  /** 1-based colour slot, used for the ring. */
  colorSlot?: number;
  leader?: boolean;
  /** Dimmed: disconnected or out of the round. */
  dim?: boolean;
  /** Change this value to replay the bounce (e.g. when the player answers). */
  pulseKey?: string | number;
  /** `data-player` hook for tests and the FLIP list. */
  playerId?: string;
}

export function Avatar({ avatarId, size = 96, colorSlot, leader, dim, pulseKey, playerId }: Props) {
  const ring = leader
    ? 'var(--qp-color-accent-a)'
    : colorSlot
      ? playerColor(colorSlot)
      : 'var(--qp-color-surface-line)';
  return (
    <div
      className={cx(styles.avatar, dim && styles.dim)}
      style={{
        width: size,
        height: size,
        ['--ring' as string]: ring,
        ['--ring-w' as string]: `${Math.max(3, Math.round(size * 0.05))}px`,
      }}
      data-player={playerId}
    >
      {leader ? (
        <Sticker id="crown" size={Math.round(size * 0.46)} className={styles.crown} />
      ) : null}
      <div key={pulseKey} className={cx(styles.ring, pulseKey !== undefined && styles.bounce)}>
        <img
          className={styles.face}
          src={avatarUrl(avatarId)}
          width={size}
          height={size}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </div>
    </div>
  );
}
