import { animationUrl, stickerUrl, type AnimationId, type StickerId } from '../lib/assets';
import styles from './Sticker.module.css';
import { cx } from '../lib/cx';

interface Props {
  id: StickerId;
  size?: number;
  className?: string;
  /** Gentle idle motion; switched off on low-power TVs. */
  float?: boolean;
}

/** Decorative static 3D sticker (alt is empty on purpose: meaning is always carried by text). */
export function Sticker({ id, size = 96, className, float }: Props) {
  return (
    <img
      className={cx(styles.sticker, float && styles.float, float && 'qp-deco', className)}
      src={stickerUrl(id)}
      data-sticker={id}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** Frame-animated reaction (loops on its own). Loaded only when a screen asks for it. */
export function AnimatedSticker({
  id,
  size = 160,
  className,
}: {
  id: AnimationId;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={cx(styles.sticker, className)}
      src={animationUrl(id)}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
