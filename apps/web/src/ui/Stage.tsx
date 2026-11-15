import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './Stage.module.css';

/** Logical TV canvas. Every TV screen is authored at 1920×1080 and scaled to fit the real screen. */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export function stageScale(width: number, height: number): number {
  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
}

export function Stage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = (): void => {
      ref.current?.style.setProperty(
        '--qp-scale',
        String(stageScale(window.innerWidth, window.innerHeight)),
      );
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, []);
  return (
    <div className={styles.viewport}>
      <div ref={ref} className={styles.stage}>
        {children}
      </div>
    </div>
  );
}
