import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  endRecord,
  extendRecord,
  meterBlock,
  meterHeld,
  meterOf,
  meterRemainingMs,
  meterView,
  pauseRecord,
  remainingMs,
  resumeRecord,
  signedRemainingMs,
  type MeterRecord,
} from './venue';

/** ADR-0024 §3: remaining = purchased − (elapsed − paused), on an injected clock. */
const MIN = 60_000;
const T0 = 1_800_000_000_000;
const open = (minutes: number, at = T0): MeterRecord => ({
  purchasedMs: minutes * MIN,
  startedAt: at,
  pausedAt: null,
  pausedTotalMs: 0,
  endedAt: null,
});

describe('venue meter arithmetic', () => {
  it('counts down with the clock and never reads below zero', () => {
    const r = open(60);
    expect(remainingMs(r, T0)).toBe(60 * MIN);
    expect(remainingMs(r, T0 + 25 * MIN)).toBe(35 * MIN);
    expect(remainingMs(r, T0 + 60 * MIN)).toBe(0);
    expect(remainingMs(r, T0 + 70 * MIN)).toBe(0);
    expect(signedRemainingMs(r, T0 + 70 * MIN)).toBe(-10 * MIN);
  });

  it('a pause stops the clock and a resume continues it where it stopped', () => {
    let r = open(60);
    r = pauseRecord(r, T0 + 10 * MIN);
    expect(remainingMs(r, T0 + 10 * MIN)).toBe(50 * MIN);
    expect(remainingMs(r, T0 + 40 * MIN)).toBe(50 * MIN);
    r = resumeRecord(r, T0 + 40 * MIN);
    expect(r.pausedTotalMs).toBe(30 * MIN);
    expect(remainingMs(r, T0 + 50 * MIN)).toBe(40 * MIN);
    // pausing twice or resuming a running clock changes nothing
    expect(pauseRecord(pauseRecord(r, T0 + 51 * MIN), T0 + 55 * MIN).pausedAt).toBe(T0 + 51 * MIN);
    expect(resumeRecord(r, T0 + 60 * MIN)).toBe(r);
  });

  it('an extension adds minutes; after time-up the overrun is not billed', () => {
    let r = open(15);
    r = extendRecord(r, 15 * MIN, T0 + 5 * MIN);
    expect(remainingMs(r, T0 + 5 * MIN)).toBe(25 * MIN);
    // ran out at +30 min; staff extend at +42 min: fifteen minutes from now, not three
    r = extendRecord(r, 15 * MIN, T0 + 42 * MIN);
    expect(remainingMs(r, T0 + 42 * MIN)).toBe(15 * MIN);
    expect(remainingMs(r, T0 + 57 * MIN)).toBe(0);
  });

  it('extending a paused table adds to what is left without unpausing it', () => {
    let r = pauseRecord(open(10), T0 + 4 * MIN);
    r = extendRecord(r, 30 * MIN, T0 + 20 * MIN);
    expect(meterOf(r, T0 + 20 * MIN)).toEqual({
      state: 'PAUSED',
      endsAt: null,
      remainingMs: 36 * MIN,
    });
  });

  it('ending freezes the remainder, also from a pause, and an ended record never changes again', () => {
    let r = pauseRecord(open(30), T0 + 10 * MIN);
    r = endRecord(r, T0 + 20 * MIN);
    expect(r.pausedAt).toBeNull();
    expect(meterOf(r, T0 + 99 * MIN)).toEqual({
      state: 'ENDED',
      endsAt: null,
      remainingMs: 20 * MIN,
    });
    expect(extendRecord(r, MIN, T0 + 100 * MIN)).toBe(r);
    expect(pauseRecord(r, T0 + 100 * MIN)).toBe(r);
    expect(endRecord(r, T0 + 100 * MIN)).toBe(r);
  });

  it('a running meter is told to the room as an absolute end time', () => {
    const r = resumeRecord(pauseRecord(open(60), T0 + MIN), T0 + 6 * MIN);
    expect(meterOf(r, T0 + 10 * MIN)).toEqual({
      state: 'RUNNING',
      endsAt: T0 + 65 * MIN,
      remainingMs: 0,
    });
  });

  it('property: remaining never grows while running, and pause time is never billed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 240 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 30 * MIN }), fc.boolean()), { maxLength: 12 }),
        (minutes, steps) => {
          let r = open(minutes);
          let now = T0;
          let paused = 0;
          for (const [gap, toggle] of steps) {
            const before = remainingMs(r, now);
            now += gap;
            if (r.pausedAt === null) expect(remainingMs(r, now)).toBeLessThanOrEqual(before);
            else {
              expect(remainingMs(r, now)).toBe(before);
              paused += gap;
            }
            if (toggle) r = r.pausedAt === null ? pauseRecord(r, now) : resumeRecord(r, now);
          }
          const running = now - T0 - paused;
          expect(remainingMs(r, now)).toBe(Math.max(0, minutes * MIN - running));
        },
      ),
    );
  });
});

describe('what a meter allows', () => {
  it('blocks a new game when the time is up, paused or ended; allows it while time runs', () => {
    expect(meterBlock(null, T0)).toBeNull();
    expect(meterBlock(undefined, T0)).toBeNull();
    const running = { state: 'RUNNING' as const, endsAt: T0 + 1000, remainingMs: 0 };
    expect(meterBlock(running, T0)).toBeNull();
    expect(meterBlock(running, T0 + 1000)).toBe('VENUE_TIME_UP');
    expect(meterBlock({ state: 'PAUSED', endsAt: null, remainingMs: 5 }, T0)).toBe('VENUE_PAUSED');
    expect(meterBlock({ state: 'ENDED', endsAt: null, remainingMs: 5 }, T0)).toBe('VENUE_TIME_UP');
  });

  it('holds the room while the table is somebody’s', () => {
    expect(meterHeld(null)).toBe(false);
    expect(meterHeld({ state: 'RUNNING', endsAt: T0, remainingMs: 0 })).toBe(true);
    expect(meterHeld({ state: 'PAUSED', endsAt: null, remainingMs: 0 })).toBe(true);
    expect(meterHeld({ state: 'ENDED', endsAt: null, remainingMs: 0 })).toBe(false);
  });

  it('shows the remaining time at the frame’s server time', () => {
    const meter = { state: 'RUNNING' as const, endsAt: T0 + 90_500, remainingMs: 0 };
    expect(meterRemainingMs(meter, T0)).toBe(90_500);
    expect(meterView(meter, T0 + 500)).toEqual({
      state: 'RUNNING',
      endsAt: T0 + 90_500,
      remainingMs: 90_000,
    });
    expect(meterView(meter, T0 + 999_999).remainingMs).toBe(0);
  });
});
