import { describe, expect, it } from 'vitest';
import { ClockSync } from './clock';

describe('ClockSync', () => {
  it('falls back to the wall clock until a sample exists', () => {
    const clock = new ClockSync(
      () => 0,
      () => 123_456,
    );
    expect(clock.hasSample()).toBe(false);
    expect(clock.serverNow()).toBe(123_456);
    expect(clock.rtt()).toBeNull();
  });

  it('anchors server time to the best (lowest round trip) sample and advances with the monotonic clock', () => {
    let perf = 1_100;
    const clock = new ClockSync(
      () => perf,
      () => 0,
    );
    // Sent at perf 1000, received at 1100 (rtt 100); the server stamped 50_000 around the midpoint.
    clock.observe(1_000, 1_100, 50_000);
    expect(clock.rtt()).toBe(100);
    expect(clock.serverNow()).toBe(50_050); // at the receive instant: stamp + rtt/2
    perf = 1_600; // 500 ms later
    expect(clock.serverNow()).toBe(50_550);
  });

  it('prefers a lower-latency sample over a noisier earlier one', () => {
    const perf = 5_000;
    const clock = new ClockSync(
      () => perf,
      () => 0,
    );
    clock.observe(1_000, 1_400, 10_000); // rtt 400
    clock.observe(2_000, 2_020, 90_000); // rtt 20 → wins
    expect(clock.rtt()).toBe(20);
    // anchored at serverAtRecv = 90_010 when perf was 2_020; now perf is 5_000 → +2_980
    expect(clock.serverNow()).toBe(92_990);
  });

  it('rejects impossible samples (negative or absurd round trips)', () => {
    const clock = new ClockSync(
      () => 0,
      () => 0,
    );
    clock.observe(100, 50, 1);
    clock.observe(0, 20_000, 1);
    clock.observe(Number.NaN, 5, 1);
    expect(clock.hasSample()).toBe(false);
  });

  // Phone screen lock: the OS monotonic clock (performance.now) stops while the device sleeps, the
  // wall clock does not. A countdown drawn from the stale sample would show seconds the server has
  // already taken away.
  it('catches up after a sleep during which only the wall clock kept running', () => {
    let perf = 1_100;
    let wall = 1_700_000_000_000;
    const clock = new ClockSync(
      () => perf,
      () => wall,
    );
    clock.observe(1_000, 1_100, 50_000);
    expect(clock.serverNow()).toBe(50_050);
    perf += 500; // awake for half a second …
    wall += 500;
    perf += 10; // … then 20 s of sleep: perf barely moves, wall jumps
    wall += 20_000;
    expect(clock.serverNow()).toBe(50_050 + 500 + 20_000);
  });

  it('does not trust a pre-sleep sample over the fresh one, even when the old one had a smaller round trip', () => {
    let perf = 1_100;
    let wall = 1_700_000_000_000;
    const clock = new ClockSync(
      () => perf,
      () => wall,
    );
    clock.observe(1_000, 1_100, 50_000); // rtt 100, the best so far
    perf += 5; // sleep: 30 s of wall time, no monotonic time
    wall += 30_000;
    clock.observe(perf - 300, perf, 80_000); // first pong after waking: rtt 300
    expect(clock.rtt()).toBe(300);
    expect(clock.serverNow()).toBe(80_150);
  });

  it('keeps the monotonic clock when the wall clock is set backwards or only jitters', () => {
    let perf = 1_100;
    let wall = 1_700_000_000_000;
    const clock = new ClockSync(
      () => perf,
      () => wall,
    );
    clock.observe(1_000, 1_100, 50_000);
    perf += 2_000;
    wall -= 3_600_000; // user changed the clock backwards
    expect(clock.serverNow()).toBe(52_050);
    wall = 1_700_000_000_000 + 2_600; // 600 ms of ordinary drift
    expect(clock.serverNow()).toBe(52_050);
  });

  it('keeps only a bounded window of samples', () => {
    const clock = new ClockSync(
      () => 0,
      () => 0,
    );
    for (let i = 0; i < 40; i++) clock.observe(0, 100 + i, 1_000);
    expect(clock.hasSample()).toBe(true);
    expect(clock.rtt()).toBeLessThanOrEqual(139);
  });
});
