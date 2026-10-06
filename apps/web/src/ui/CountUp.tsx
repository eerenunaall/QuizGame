import { useEffect, useRef } from 'react';
import { easeOutCubic, isLowMotion } from '../lib/motion';

interface Props {
  value: number;
  durationMs?: number;
  /** Start from this value on first render (default: show `value` immediately). */
  from?: number;
  format?: (value: number) => string;
  className?: string;
}

const plain = (value: number): string => String(Math.round(value));

/** A number that glides to its new value. Writes the DOM directly: no re-render per frame. */
export function CountUp({ value, durationMs = 900, from, format = plain, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(from ?? value);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const start = shown.current;
    if (start === value || isLowMotion() || durationMs <= 0) {
      shown.current = value;
      element.textContent = format(value);
      return undefined;
    }
    let frame = 0;
    let begin = 0;
    const tick = (now: number): void => {
      if (begin === 0) begin = now;
      const t = easeOutCubic((now - begin) / durationMs);
      shown.current = start + (value - start) * t;
      element.textContent = format(shown.current);
      if (t < 1) frame = window.requestAnimationFrame(tick);
      else {
        shown.current = value;
        element.textContent = format(value);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, durationMs, format]);
  return (
    <span ref={ref} className={className}>
      {format(shown.current)}
    </span>
  );
}
