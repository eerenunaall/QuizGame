import { useLayoutEffect, useRef, type RefObject } from 'react';
import { isLowMotion } from '../../lib/motion';

/** The entrance every phone screen shares: rises 14 px and fades in. */
export const ENTRANCE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(14px)' },
  { opacity: 1, transform: 'translateY(0)' },
];

/**
 * Gives a container a short entrance whenever `key` changes (a new phase), without remounting its
 * children, so screens keep their state. The first paint plays it too: that is the page-load
 * transition. Skipped for reduced motion, low-power devices and browsers without the Web Animations
 * API.
 */
export function usePhaseEntrance(ref: RefObject<HTMLElement | null>, key: string | null): void {
  const previous = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || previous.current === key) return;
    previous.current = key;
    if (isLowMotion() || typeof element.animate !== 'function') return;
    element.animate(ENTRANCE, { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }, [ref, key]);
}
