import { isLowMotion } from './motion';

type ConfettiFn = (options?: Record<string, unknown>) => Promise<null> | null;

let instance: Promise<ConfettiFn> | null = null;

/**
 * Confetti is drawn on our own full-screen canvas. `useWorker: false` keeps the strict CSP free of
 * `blob:` workers; the library is loaded only when something is first celebrated.
 */
export function mountConfetti(canvas: HTMLCanvasElement): void {
  instance = import('canvas-confetti').then(
    (module) =>
      module.default.create(canvas, { resize: true, useWorker: false }) as unknown as ConfettiFn,
  );
}

export function unmountConfetti(): void {
  instance = null;
}

const COLORS = ['#ffc928', '#8f3dff', '#f23e5a', '#2f8bff', '#25c85a', '#2de2e6', '#ffffff'];

async function fire(options: Record<string, unknown>): Promise<void> {
  if (!instance || isLowMotion()) return;
  const confetti = await instance;
  void confetti({ colors: COLORS, disableForReducedMotion: true, ...options });
}

/** A single burst from a point (0–1 coordinates). */
export function burst(x = 0.5, y = 0.6, particleCount = 140): void {
  void fire({ particleCount, spread: 80, startVelocity: 48, origin: { x, y }, ticks: 220 });
}

/** Two cannons from the bottom corners, the "winner" moment. */
export function cannons(): void {
  for (const x of [0.05, 0.95]) {
    void fire({
      particleCount: 120,
      angle: x < 0.5 ? 60 : 120,
      spread: 70,
      startVelocity: 70,
      origin: { x, y: 0.95 },
      ticks: 260,
    });
  }
}

/** Gentle shower for the results screen. Returns a stop function. */
export function shower(durationMs = 4_000): () => void {
  let stopped = false;
  const end = Date.now() + durationMs;
  const step = (): void => {
    if (stopped || Date.now() > end) return;
    void fire({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, startVelocity: 55 });
    void fire({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, startVelocity: 55 });
    window.setTimeout(step, 180);
  };
  step();
  return () => {
    stopped = true;
  };
}
