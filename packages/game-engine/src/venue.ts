/**
 * Venue mode meter (ADR-0024). Pure arithmetic over server times passed in by the caller: the server
 * owns the clock, tests inject one. `remaining = purchased − (elapsed − paused)`.
 */
import type { EpochMs } from './types';

/** What a room knows about its table: enough to gate games and draw the TV chip, nothing else. */
export interface VenueMeter {
  state: 'RUNNING' | 'PAUSED' | 'ENDED';
  /** RUNNING: the server time at which the paid time is used up. Null otherwise. */
  endsAt: EpochMs | null;
  /** PAUSED / ENDED: what was left when the clock stopped. RUNNING: unused (0). */
  remainingMs: number;
}

/** The stored facts of a session (milliseconds), as the database keeps them. */
export interface MeterRecord {
  purchasedMs: number;
  startedAt: EpochMs;
  pausedAt: EpochMs | null;
  pausedTotalMs: number;
  endedAt: EpochMs | null;
}

/** Time paid for and not yet used at `now`; negative once the table overran (a round finishing after time-up). */
export function signedRemainingMs(record: MeterRecord, now: EpochMs): number {
  // A stopped clock (paused or ended) is read at the moment it stopped.
  const until = record.endedAt ?? record.pausedAt ?? now;
  const elapsed = Math.max(0, until - record.startedAt);
  return record.purchasedMs - (elapsed - record.pausedTotalMs);
}

export function remainingMs(record: MeterRecord, now: EpochMs): number {
  return Math.max(0, signedRemainingMs(record, now));
}

/** The meter a room is told about. */
export function meterOf(record: MeterRecord, now: EpochMs): VenueMeter {
  const left = remainingMs(record, now);
  if (record.endedAt !== null) return { state: 'ENDED', endsAt: null, remainingMs: left };
  if (record.pausedAt !== null) return { state: 'PAUSED', endsAt: null, remainingMs: left };
  return {
    state: 'RUNNING',
    endsAt: Math.round(now + signedRemainingMs(record, now)),
    remainingMs: 0,
  };
}

/**
 * Adds paid time. When the table already ran out, the overrun since then is not billed: it is folded
 * into the paused total first, so "+15 min" always means fifteen minutes from now.
 */
export function extendRecord(record: MeterRecord, addMs: number, now: EpochMs): MeterRecord {
  if (record.endedAt !== null) return record;
  const left = signedRemainingMs(record, now);
  const forgiven = left < 0 && record.pausedAt === null ? -left : 0;
  return {
    ...record,
    purchasedMs: record.purchasedMs + addMs,
    pausedTotalMs: record.pausedTotalMs + forgiven,
  };
}

export function pauseRecord(record: MeterRecord, now: EpochMs): MeterRecord {
  if (record.endedAt !== null || record.pausedAt !== null) return record;
  return { ...record, pausedAt: now };
}

export function resumeRecord(record: MeterRecord, now: EpochMs): MeterRecord {
  if (record.endedAt !== null || record.pausedAt === null) return record;
  return {
    ...record,
    pausedAt: null,
    pausedTotalMs: record.pausedTotalMs + Math.max(0, now - record.pausedAt),
  };
}

export function endRecord(record: MeterRecord, now: EpochMs): MeterRecord {
  if (record.endedAt !== null) return record;
  // Ending a paused table: the pause is closed at the same instant, so the stored remainder stays exact.
  const resumed = resumeRecord(record, now);
  return { ...resumed, endedAt: now };
}

/** Time left on a room's meter at `now` (0 when paused/ended reads what was left). */
export function meterRemainingMs(meter: VenueMeter, now: EpochMs): number {
  if (meter.state === 'RUNNING') return Math.max(0, (meter.endsAt ?? now) - now);
  return Math.max(0, meter.remainingMs);
}

/** Why a new game may not start on this meter, or null when it may. */
export function meterBlock(
  meter: VenueMeter | null | undefined,
  now: EpochMs,
): 'VENUE_TIME_UP' | 'VENUE_PAUSED' | null {
  if (!meter) return null;
  if (meter.state === 'ENDED') return 'VENUE_TIME_UP';
  if (meter.state === 'PAUSED') return 'VENUE_PAUSED';
  return meterRemainingMs(meter, now) > 0 ? null : 'VENUE_TIME_UP';
}

/** A table that is still somebody's (not ended): the room is kept alive while it waits for them. */
export const meterHeld = (meter: VenueMeter | null | undefined): boolean =>
  meter !== null && meter !== undefined && meter.state !== 'ENDED';

/** The public view of a meter at a frame's server time. */
export function meterView(
  meter: VenueMeter,
  now: EpochMs,
): { state: VenueMeter['state']; endsAt: EpochMs | null; remainingMs: number } {
  return {
    state: meter.state,
    endsAt: meter.state === 'RUNNING' ? meter.endsAt : null,
    remainingMs: Math.floor(meterRemainingMs(meter, now)),
  };
}
