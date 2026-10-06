import { useRef } from 'react';
import { useFrameLoop } from '../lib/motion';
import styles from './CountdownRing.module.css';

interface Props {
  /** Server-synchronised clock (epoch ms). */
  now: () => number;
  startAt: number;
  deadlineAt: number;
  size?: number;
  /** Called once per whole second boundary crossed, with the seconds left (for tick sounds). */
  onSecond?: (secondsLeft: number) => void;
  /** Seconds at or below which the ring turns urgent. */
  urgentAt?: number;
}

const STROKE = 14;

export function remainingSeconds(deadlineAt: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

/**
 * Circular timer. The server owns the deadline; this only draws it. It updates the DOM directly
 * inside one animation-frame loop, so a running timer never re-renders React.
 */
export function CountdownRing({
  now,
  startAt,
  deadlineAt,
  size = 168,
  onSecond,
  urgentAt = 3,
}: Props) {
  const circleRef = useRef<SVGCircleElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastSecond = useRef<number | null>(null);
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(1, deadlineAt - startAt);

  const draw = (): boolean => {
    const remaining = Math.max(0, deadlineAt - now());
    const fraction = Math.min(1, remaining / total);
    const seconds = remainingSeconds(deadlineAt, now());
    circleRef.current?.setAttribute('stroke-dashoffset', String(circumference * (1 - fraction)));
    if (textRef.current && textRef.current.textContent !== String(seconds))
      textRef.current.textContent = String(seconds);
    const urgent = seconds <= urgentAt && remaining > 0;
    if (rootRef.current) {
      if (urgent) rootRef.current.setAttribute('data-urgent', 'true');
      else rootRef.current.removeAttribute('data-urgent');
    }
    if (lastSecond.current !== seconds) {
      lastSecond.current = seconds;
      onSecond?.(seconds);
    }
    return remaining > 0;
  };

  useFrameLoop(draw);

  const initial = remainingSeconds(deadlineAt, now());
  return (
    <div
      ref={rootRef}
      className={styles.ring}
      style={{ width: size, height: size }}
      role="timer"
      aria-live="off"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={styles.svg}
        aria-hidden="true"
      >
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={STROKE}
          fill="none"
        />
        <circle
          ref={circleRef}
          className={styles.progress}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={0}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span ref={textRef} className={styles.text} style={{ fontSize: size * 0.42 }}>
        {initial}
      </span>
    </div>
  );
}
