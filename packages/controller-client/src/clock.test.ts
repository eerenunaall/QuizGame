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
