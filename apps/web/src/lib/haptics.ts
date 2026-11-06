import { isLowMotion } from './motion';

/**
 * Phone vibration. Every pattern is short on purpose: a table of players holding their phones should
 * feel a nudge, not hear a buzz. Unsupported browsers (iOS Safari) and reduced-motion users get
 * nothing, and nothing here can throw.
 */
export type HapticKind =
  'tap' | 'lock' | 'correct' | 'wrong' | 'combo' | 'hit' | 'urgent3' | 'urgent2' | 'urgent1';

/** ms on / off / on ... The last-three-seconds beats grow with the danger: 3 is light, 1 is firm. */
export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 12,
  lock: 35,
  correct: [30, 45, 30, 45, 70],
  wrong: [120],
  combo: [20, 30, 20, 30, 20, 30, 90],
  hit: [70, 40, 110],
  urgent3: 14,
  urgent2: [18, 60, 18],
  urgent1: [26, 50, 26, 50, 60],
};

/** Patterns that repeat or pulse are motion-like; those are skipped when motion is reduced. */
const PULSING: ReadonlySet<HapticKind> = new Set([
  'combo',
  'hit',
  'urgent3',
  'urgent2',
  'urgent1',
  'correct',
]);

/** The pattern to play, or `null` when this kind must stay silent under the given settings. */
export function hapticPattern(kind: HapticKind, reduced: boolean): number | number[] | null {
  if (reduced && PULSING.has(kind)) return null;
  return HAPTIC_PATTERNS[kind];
}

export function haptic(kind: HapticKind): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const pattern = hapticPattern(kind, isLowMotion());
    if (pattern !== null) navigator.vibrate(pattern);
  } catch {
    // not supported or blocked
  }
}

/** The beat for the whole second that starts with `secondsLeft` (3, 2, 1) on the clock. */
export function urgencyHaptic(secondsLeft: number): HapticKind | null {
  if (secondsLeft === 3) return 'urgent3';
  if (secondsLeft === 2) return 'urgent2';
  if (secondsLeft === 1) return 'urgent1';
  return null;
}
