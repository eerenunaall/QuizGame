import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Draws children at a fixed design size (the TV's 1920x1080 stage, or a phone's 390 px) and scales the
 * whole thing to the width available, so a preview looks exactly like the screen it stands for.
 */
export function ScaledStage({
  width,
  height,
  children,
  label,
  testId,
}: {
  width: number;
  height: number;
  children: ReactNode;
  label: string;
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const measure = (): void => {
      const available = element.clientWidth;
      if (available > 0) setScale(Math.min(1, available / width));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      data-testid={testId}
      style={{
        position: 'relative',
        width: '100%',
        height: Math.round(height * scale),
        overflow: 'hidden',
        borderRadius: 14,
        border: '2px solid var(--qp-color-surface-line)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
