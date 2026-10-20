import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Reads `prefers-reduced-motion` and follows changes. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matches('(prefers-reduced-motion: reduce)'));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    if (query.addEventListener) query.addEventListener('change', update);
    else query.addListener(update);
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', update);
      else query.removeListener(update);
    };
  }, []);
  return reduced;
}

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/** True when decorative motion should be skipped (reduced motion or a low-power TV). */
export function isLowMotion(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.dataset.motion === 'low' || matches('(prefers-reduced-motion: reduce)')
  );
}

/**
 * Runs `callback` on every animation frame while `active`. One loop per screen element: timers and
 * counters update the DOM directly instead of re-rendering React 60 times a second.
 */
export function useFrameLoop(callback: (nowMs: number) => boolean | void, active = true): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    if (!active) return undefined;
    let frame = 0;
    let cancelled = false;
    const tick = (now: number): void => {
      if (cancelled) return;
      const keepGoing = callbackRef.current(now);
      if (keepGoing === false) return;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [active]);
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/**
 * FLIP re-ordering: after React re-orders keyed children, each child glides from where it was to
 * where it is now. Children opt in with `data-flip-key`.
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>, signature: string): void {
  const previous = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const lowMotion = isLowMotion();
    const next = new Map<string, DOMRect>();
    container.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((element) => {
      const key = element.dataset.flipKey;
      if (!key) return;
      const rect = element.getBoundingClientRect();
      next.set(key, rect);
      const before = previous.current.get(key);
      if (!before || lowMotion || typeof element.animate !== 'function') return;
      const dx = before.left - rect.left;
      const dy = before.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    });
    previous.current = next;
  }, [containerRef, signature]);
}
