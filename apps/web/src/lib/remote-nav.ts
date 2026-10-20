/**
 * Spatial focus navigation for TV remotes: arrow keys move focus to the nearest focusable element
 * in that direction. Enter/OK is the browser's own button activation. Pure geometry, so it is
 * testable without a browser.
 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

const center = (box: Box): { x: number; y: number } => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2,
});

/** Index of the best candidate in `direction` from `from`, or -1 when nothing lies that way. */
export function pickNext(from: Box, candidates: readonly Box[], direction: Direction): number {
  const origin = center(from);
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    const target = center(candidate);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const along =
      direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    if (along <= 1) return; // not in that direction
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    // prefer targets straight ahead; sideways drift costs double
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

const KEYS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

export function installRemoteNavigation(root: HTMLElement, onBack?: () => void): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const direction = KEYS[event.key];
    if (direction) {
      // An open dialog owns the remote: focus never wanders to controls hidden behind it.
      const scope = root.querySelector<HTMLElement>('[aria-modal="true"]') ?? root;
      const items = Array.from(scope.querySelectorAll<HTMLElement>('[data-focusable]')).filter(
        (element) => !(element as HTMLButtonElement).disabled && element.offsetParent !== null,
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const current = active && items.includes(active) ? active : null;
      if (!current) {
        items[0]?.focus();
        event.preventDefault();
        return;
      }
      const index = pickNext(
        current.getBoundingClientRect(),
        items.map((element) => element.getBoundingClientRect()),
        direction,
      );
      const next = items[index];
      if (next) {
        next.focus();
        event.preventDefault();
      }
      return;
    }
    // Back keys: Escape/Backspace, Tizen 10009, webOS 461, Android TV 4
    if (
      event.key === 'Escape' ||
      event.key === 'GoBack' ||
      [10009, 461, 4].includes(event.keyCode)
    ) {
      onBack?.();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
