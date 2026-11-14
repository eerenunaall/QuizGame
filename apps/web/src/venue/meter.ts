import { useEffect, useState } from 'react';
import type { VenueMeterView } from '@quizparty/protocol';

/** Venue mode (ADR-0024): what a screen draws for a table's meter. The server decides; this only shows it. */
export type MeterTone = 'calm' | 'amber' | 'red' | 'paused' | 'up';

export function meterLeftMs(venue: VenueMeterView, now: number): number {
  if (venue.state === 'RUNNING' && venue.endsAt !== null) return Math.max(0, venue.endsAt - now);
  return venue.state === 'ENDED' ? 0 : Math.max(0, venue.remainingMs);
}

/** Amber from five minutes left, red from one; paused and used-up are their own states. */
export function meterTone(venue: VenueMeterView, now: number): MeterTone {
  if (venue.state === 'ENDED') return 'up';
  const left = meterLeftMs(venue, now);
  if (venue.state === 'PAUSED') return left > 0 ? 'paused' : 'up';
  if (left <= 0) return 'up';
  if (left <= 60_000) return 'red';
  if (left <= 5 * 60_000) return 'amber';
  return 'calm';
}

/** A new game may not start: time used up, ended, or paused. */
export const meterBlocked = (
  venue: VenueMeterView | undefined,
  now: number,
): 'up' | 'paused' | null => {
  if (!venue) return null;
  const tone = meterTone(venue, now);
  return tone === 'up' ? 'up' : tone === 'paused' ? 'paused' : null;
};

/** m:ss under an hour, h:mm:ss above (rounded up, so "0:00" only when the time is really gone). */
export function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Re-renders every `everyMs` while `active`, returning the current time from `now`. */
export function useTicker(now: () => number, active: boolean, everyMs = 1000): number {
  const [time, setTime] = useState(now);
  useEffect(() => {
    if (!active) return undefined;
    setTime(now());
    const timer = setInterval(() => setTime(now()), everyMs);
    return () => clearInterval(timer);
  }, [now, active, everyMs]);
  return active ? time : now();
}
