import { useRef } from 'react';
import { useFrameLoop } from '../lib/motion';
import styles from './TimerBar.module.css';

interface Props {
  now: () => number;
  startAt: number;
  deadlineAt: number;
}

export function formatClock(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `00:${String(seconds).padStart(2, '0')}`;
}

/** Linear timer for phones: a bar that drains and a 00:08 label. DOM-driven like the TV ring. */
export function TimerBar({ now, startAt, deadlineAt }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const total = Math.max(1, deadlineAt - startAt);

  useFrameLoop(() => {
    const remaining = Math.max(0, deadlineAt - now());
    if (fillRef.current)
      fillRef.current.style.transform = `scaleX(${Math.min(1, remaining / total)})`;
    const label = formatClock(remaining);
    if (textRef.current && textRef.current.textContent !== label)
      textRef.current.textContent = label;
    const urgent = remaining > 0 && remaining <= 3000;
    if (rootRef.current) {
      if (urgent) rootRef.current.setAttribute('data-urgent', 'true');
      else rootRef.current.removeAttribute('data-urgent');
    }
    return remaining > 0;
  });

  return (
    <div ref={rootRef} className={styles.timer} role="timer" aria-live="off">
      <span ref={textRef} className={styles.label}>
        {formatClock(deadlineAt - now())}
      </span>
      <div className={styles.track}>
        <div ref={fillRef} className={styles.fill} />
      </div>
    </div>
  );
}
