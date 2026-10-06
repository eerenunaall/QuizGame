import { useEffect, useRef } from 'react';
import { mountConfetti, unmountConfetti } from '../lib/confetti';
import styles from './ConfettiLayer.module.css';

/** Full-screen canvas for celebrations; mount once per screen that celebrates. */
export function ConfettiLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) mountConfetti(ref.current);
    return unmountConfetti;
  }, []);
  return <canvas ref={ref} className={styles.layer} aria-hidden="true" />;
}
