import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HitImpact, hitKey, resetImpact, shouldPlayImpact } from './HitImpact';
import { ComboToast, comboPlayers } from './ComboToast';
import { PhaseSweep } from './PhaseSweep';
import { RevealBurst, rayVector } from './RevealBurst';
import { ScoreBar, barFraction } from './ScoreBar';
import { StreakFlame, flameLevel } from './StreakFlame';
import { UrgencyVignette, urgentSecond } from './UrgencyVignette';
import { ENTRANCE } from './usePhaseEntrance';
import { HAPTIC_PATTERNS, hapticPattern, urgencyHaptic } from '../../lib/haptics';
import { sfx } from '../../lib/audio';

afterEach(cleanup);

describe('streak flame', () => {
  it('appears from the second answer in a row and burns hotter with the streak', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(flameLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('draws nothing for a streak of one and the count for a real streak', () => {
    const { container, rerender } = render(<StreakFlame streak={1} />);
    expect(container.firstChild).toBeNull();
    rerender(<StreakFlame streak={4} label="4 correct in a row" />);
    const flame = screen.getByTestId('streak-flame');
    expect(flame.textContent).toBe('4');
    expect(flame.getAttribute('aria-label')).toBe('4 correct in a row');
    expect(flame.getAttribute('data-streak')).toBe('4');
  });

  it('is decorative when no label is given', () => {
    render(<StreakFlame streak={3} />);
    expect(screen.getByTestId('streak-flame').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('combo toast', () => {
  it('shows the words, the optional name line and a flame', () => {
    render(<ComboToast streak={3} text="3 IN A ROW!" label="Ahmet" size="tv" delayMs={900} />);
    const toast = screen.getByTestId('combo-toast');
    expect(toast.textContent).toContain('3 IN A ROW!');
    expect(toast.textContent).toContain('Ahmet');
    expect(toast.style.getPropertyValue('--qp-delay')).toBe('900ms');
    expect(screen.getByTestId('streak-flame')).toBeTruthy();
  });

  it('picks the longest streaks, at most three, and only real combos', () => {
    const entries = [
      { id: 'a', streak: 2 },
      { id: 'b', streak: 7 },
      { id: 'c', streak: 3 },
      { id: 'd', streak: 5 },
      { id: 'e', streak: 4 },
    ];
    expect(comboPlayers(entries).map((entry) => entry.id)).toEqual(['b', 'd', 'e']);
    expect(comboPlayers(entries, 8)).toEqual([]);
    expect(entries).toHaveLength(5); // the input is not reordered
  });
});

describe('urgency', () => {
  it('is urgent only inside the last three seconds, counting whole seconds up', () => {
    expect(urgentSecond(5000)).toBeNull();
    expect(urgentSecond(3001)).toBeNull();
    expect(urgentSecond(3000)).toBe(3);
    expect(urgentSecond(2100)).toBe(3);
    expect(urgentSecond(2000)).toBe(2);
    expect(urgentSecond(1)).toBe(1);
    expect(urgentSecond(0)).toBeNull();
    expect(urgentSecond(-50)).toBeNull();
  });

  it('turns on for the last seconds of a server deadline and vibrates once per second', () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    let clock = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { container } = render(
      <UrgencyVignette now={() => clock} deadlineAt={10_000} haptics tone="phone" />,
    );
    const run = (): void => {
      const pending = frames.splice(0);
      pending.forEach((callback) => callback(clock));
    };
    const root = container.firstChild as HTMLElement;
    run();
    expect(root.getAttribute('data-active')).toBeNull();
    expect(vibrate).not.toHaveBeenCalled();
    clock = 7500; // 2.5 s left -> second 3
    run();
    expect(root.getAttribute('data-active')).toBe('true');
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.urgent3);
    clock = 7600;
    run();
    expect(vibrate).toHaveBeenCalledTimes(1); // same second: no second buzz
    clock = 8500;
    run();
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.urgent2);
    clock = 9500;
    run();
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.urgent1);
    clock = 10_100;
    run();
    expect(root.getAttribute('data-active')).toBeNull();
    Reflect.deleteProperty(navigator, 'vibrate');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});

describe('haptics', () => {
  it('beats grow firmer as the clock runs out', () => {
    expect([3, 2, 1, 4, 0].map(urgencyHaptic)).toEqual([
      'urgent3',
      'urgent2',
      'urgent1',
      null,
      null,
    ]);
    const total = (kind: 'urgent3' | 'urgent2' | 'urgent1'): number => {
      const pattern = HAPTIC_PATTERNS[kind];
      return typeof pattern === 'number' ? pattern : pattern.reduce((a, b) => a + b, 0);
    };
    expect(total('urgent3')).toBeLessThan(total('urgent2'));
    expect(total('urgent2')).toBeLessThan(total('urgent1'));
  });

  it('keeps taps and locks under reduced motion but drops the pulsing patterns', () => {
    expect(hapticPattern('tap', true)).toBe(HAPTIC_PATTERNS.tap);
    expect(hapticPattern('lock', true)).toBe(HAPTIC_PATTERNS.lock);
    expect(hapticPattern('wrong', true)).toBe(HAPTIC_PATTERNS.wrong);
    for (const kind of ['urgent3', 'urgent2', 'urgent1', 'hit', 'combo'] as const)
      expect(hapticPattern(kind, true)).toBeNull();
    expect(hapticPattern('hit', false)).toBe(HAPTIC_PATTERNS.hit);
  });
});

describe('score bar', () => {
  it('is the share of the leader, clamped, and empty on an empty board', () => {
    expect(barFraction(50, 100)).toBe(0.5);
    expect(barFraction(150, 100)).toBe(1);
    expect(barFraction(-5, 100)).toBe(0);
    expect(barFraction(10, 0)).toBe(0);
  });

  it('carries the start and end of its growth as variables', () => {
    render(<ScoreBar from={0.25} to={0.75} delayMs={300} />);
    const fill = screen.getByTestId('score-bar').firstChild as HTMLElement;
    expect(fill.style.getPropertyValue('--qp-from')).toBe('0.25');
    expect(fill.style.getPropertyValue('--qp-to')).toBe('0.75');
    expect(fill.style.transform).toBe('translateX(-25%)');
    expect(fill.style.animationDelay).toBe('300ms');
  });
});

describe('reveal burst', () => {
  it('sends twelve rays out evenly with varied reach', () => {
    const rays = Array.from({ length: 12 }, (_, index) => rayVector(index));
    expect(rays[0]!.angle).toBe(0);
    expect(rays[6]!.angle).toBe(180);
    expect(new Set(rays.map((ray) => ray.distance)).size).toBeGreaterThan(1);
    render(<RevealBurst delayMs={800} />);
    const burst = screen.getByTestId('reveal-burst');
    expect(burst.getAttribute('aria-hidden')).toBe('true');
    expect(burst.querySelectorAll('span').length).toBe(13); // flash + 12 rays
  });
});

describe('phase sweep', () => {
  it('restarts when the phase changes and is hidden from assistive tech', () => {
    const { container, rerender } = render(<PhaseSweep phase="QUESTION" />);
    const first = container.firstChild;
    expect((first as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    rerender(<PhaseSweep phase="REVEAL" />);
    expect(container.firstChild).not.toBe(first); // re-keyed: the animation plays again
  });

  it('has a short rise-and-fade entrance for phone screens', () => {
    expect(ENTRANCE[0]).toMatchObject({ opacity: 0 });
    expect(ENTRANCE[1]).toMatchObject({ opacity: 1, transform: 'translateY(0)' });
  });
});

describe('hit impact', () => {
  beforeEach(() => {
    resetImpact();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not replay the same hits on the next screen of the same question', () => {
    const hits = [{ effect: 'JAM', blocked: false }] as const;
    expect(hitKey(hits)).toBe('JAM:hit');
    expect(shouldPlayImpact('', 0)).toBe(false);
    expect(shouldPlayImpact('JAM:hit', 1000)).toBe(true);
    expect(shouldPlayImpact('JAM:hit', 2000)).toBe(false);
    expect(shouldPlayImpact('FOG:hit', 2500)).toBe(true);
    expect(shouldPlayImpact('FOG:hit', 20_000)).toBe(true); // a later round hits again
  });

  it('plays the cue of each effect, flashes once and shakes the page unless motion is reduced', () => {
    const play = vi.spyOn(sfx, 'play').mockImplementation(() => undefined);
    const page = document.createElement('main');
    const animate = vi.fn();
    page.animate = animate as never;
    document.body.append(page);
    const { unmount } = render(
      <HitImpact
        hits={[
          { effect: 'FOG', blocked: false },
          { effect: 'JAM', blocked: true },
        ]}
      />,
      { container: page.appendChild(document.createElement('div')) },
    );
    act(() => void vi.advanceTimersByTime(300));
    expect(play.mock.calls.map(([name]) => name)).toEqual(['hitFog', 'shield']);
    expect(document.querySelector('[data-testid="hit-flash"]')).not.toBeNull();
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(1300));
    expect(document.querySelector('[data-testid="hit-flash"]')).toBeNull();
    unmount();
    page.remove();
  });

  it('a blocked hit gets the shield glint and no shake', () => {
    const play = vi.spyOn(sfx, 'play').mockImplementation(() => undefined);
    const page = document.createElement('main');
    const animate = vi.fn();
    page.animate = animate as never;
    document.body.append(page);
    render(<HitImpact hits={[{ effect: 'LOCKOUT', blocked: true }]} />, {
      container: page.appendChild(document.createElement('div')),
    });
    act(() => void vi.advanceTimersByTime(50));
    expect(play).toHaveBeenCalledWith('shield');
    expect(animate).not.toHaveBeenCalled();
    page.remove();
  });
});
