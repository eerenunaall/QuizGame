import { useRef } from 'react';
import { haptic, urgencyHaptic } from '../../lib/haptics';
import { useFrameLoop } from '../../lib/motion';
import styles from './UrgencyVignette.module.css';

interface Props {
  /** Server-synchronised clock (epoch ms). */
  now: () => number;
  deadlineAt: number;
  /** The last N milliseconds are "urgent". */
  thresholdMs?: number;
  /** Phones: a vibration beat on each of the last three seconds. */
  haptics?: boolean;
  /** `phone`: a lighter edge so it never covers the answers. */
  tone?: 'tv' | 'phone';
}

/** Whole seconds left (rounded up) when the clock is inside the urgent window, else null. */
export function urgentSecond(remainingMs: number, thresholdMs = 3000): number | null {
  if (remainingMs <= 0 || remainingMs > thresholdMs) return null;
  return Math.ceil(remainingMs / 1000);
}

/**
 * A red glow around the screen edge for the last seconds of a question: the room can feel the clock
 * without reading it. Opacity-only (a static gradient pulses), pointer-transparent and driven by the
 * same server deadline as the timer. Under reduced motion it stays as a calm, still edge.
 */
export function UrgencyVignette({
  now,
  deadlineAt,
  thresholdMs = 3000,
  haptics = false,
  tone = 'tv',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastSecond = useRef<number | null>(null);

  useFrameLoop(() => {
    const remaining = deadlineAt - now();
    const second = urgentSecond(remaining, thresholdMs);
    const root = ref.current;
    if (root) {
      if (second !== null) root.setAttribute('data-active', 'true');
      else root.removeAttribute('data-active');
    }
    if (second !== lastSecond.current) {
      lastSecond.current = second;
      if (second !== null && haptics) {
        const kind = urgencyHaptic(second);
        if (kind) haptic(kind);
      }
    }
    return remaining > 0;
  });

  return <div ref={ref} className={styles.vignette} data-tone={tone} aria-hidden="true" />;
}
