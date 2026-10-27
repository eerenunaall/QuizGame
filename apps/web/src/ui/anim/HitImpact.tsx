import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HitView } from '@quizparty/protocol';
import { hitSoundFor, sfx } from '../../lib/audio';
import { haptic } from '../../lib/haptics';
import { isLowMotion } from '../../lib/motion';
import styles from './HitImpact.module.css';

/** A hit repeated on the next screen of the same question (prep, then answering) must not hit twice. */
const REPLAY_WINDOW_MS = 8000;
let lastKey = '';
let lastAt = -Infinity;

/** Stable identity of what landed on this phone, regardless of order of arrival. */
export function hitKey(hits: readonly HitView[]): string {
  return hits.map((hit) => `${hit.effect}:${hit.blocked ? 'blocked' : 'hit'}`).join(',');
}

/** True when this set of hits should play its impact now (new, or older than the replay window). */
export function shouldPlayImpact(key: string, nowMs: number): boolean {
  if (key === '') return false;
  if (key === lastKey && nowMs - lastAt < REPLAY_WINDOW_MS) return false;
  lastKey = key;
  lastAt = nowMs;
  return true;
}

export function resetImpact(): void {
  lastKey = '';
  lastAt = -Infinity;
}

const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-12px) rotate(-0.4deg)', offset: 0.14 },
  { transform: 'translateX(10px) rotate(0.3deg)', offset: 0.3 },
  { transform: 'translateX(-7px)', offset: 0.5 },
  { transform: 'translateX(4px)', offset: 0.7 },
  { transform: 'translateX(0)' },
];

/**
 * The moment a sabotage lands on this phone: a coloured flash over the screen edge, a short shake
 * of the page, the hit's own sound and a vibration. A blocked hit is the opposite beat (a shield
 * glint, no shake). Reduced motion keeps the sound, the notice card and the vibration but drops the
 * shake and the flash.
 */
export function HitImpact({ hits }: { hits: readonly HitView[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [flash, setFlash] = useState<'hit' | 'blocked' | null>(null);
  const key = hitKey(hits);

  useEffect(() => {
    if (!shouldPlayImpact(key, performance.now())) return;
    // Fire-and-forget: a sound, a buzz and a shake that outlive a re-render are harmless, and
    // cancelling them on cleanup would silence the hit under React's dev double-invoke.
    hits.forEach((hit, index) => {
      window.setTimeout(
        () => sfx.play(hit.blocked ? 'shield' : hitSoundFor(hit.effect)),
        index * 260,
      );
    });
    const landed = hits.some((hit) => !hit.blocked);
    setFlash(landed ? 'hit' : 'blocked');
    if (landed) {
      haptic('hit');
      const page = anchor.current?.closest('main');
      if (page && !isLowMotion() && typeof page.animate === 'function')
        page.animate(SHAKE, { duration: 420, easing: 'ease-out' });
    }
    // The flash removes itself when its animation ends; this covers browsers that skip the event.
    window.setTimeout(() => setFlash(null), 1200);
    // `hits` is covered by `key`; a new array of the same hits must not replay the impact
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <>
      <span ref={anchor} className={styles.anchor} aria-hidden="true" />
      {flash
        ? // outside <main>: the page shake must not drag the flash (a transform re-parents fixed boxes)
          createPortal(
            <span
              className={`${styles.flash} ${styles[flash]} qp-deco`}
              data-testid="hit-flash"
              onAnimationEnd={() => setFlash(null)}
            />,
            document.body,
          )
        : null}
    </>
  );
}
