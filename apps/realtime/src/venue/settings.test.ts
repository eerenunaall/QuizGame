import { describe, expect, it } from 'vitest';
import {
  localDate,
  localDay,
  mergeSettings,
  newRewardCode,
  parseRewardCode,
  readSettings,
  VenueSettingsPatchSchema,
} from './settings';

describe('venue settings', () => {
  it('reads an empty or broken row as the documented defaults (reward off)', () => {
    const defaults = {
      reward: { enabled: false, text: '', minPlayers: 3, maxPerDay: 10, rematchCooldownMinutes: 5 },
      defaultMinutes: 60,
      extendSteps: [15, 30, 60],
      timezone: 'Europe/Istanbul',
    };
    expect(readSettings({})).toEqual(defaults);
    expect(readSettings(null)).toEqual(defaults);
    expect(readSettings({ reward: { enabled: 'yes' } })).toEqual(defaults);
  });

  it('merges a patch without resetting what the owner did not send', () => {
    const current = readSettings({ reward: { enabled: true, text: 'Çay', minPlayers: 4 } });
    const patch = VenueSettingsPatchSchema.parse({ reward: { maxPerDay: 3 } });
    expect(mergeSettings(current, patch)?.reward).toEqual({
      enabled: true,
      text: 'Çay',
      minPlayers: 4,
      maxPerDay: 3,
      rematchCooldownMinutes: 5,
    });
  });

  it('refuses an enabled reward with no text', () => {
    expect(mergeSettings(readSettings({}), { reward: { enabled: true } })).toBeNull();
  });
});

describe('the venue day', () => {
  it('runs from local midnight to local midnight (Istanbul is UTC+3)', () => {
    // 2026-10-19 23:30 in Istanbul is 20:30 UTC
    const at = Date.UTC(2026, 9, 19, 20, 30);
    const day = localDay(at, 'Europe/Istanbul');
    expect(new Date(day.start).toISOString()).toBe('2026-10-18T21:00:00.000Z');
    expect(new Date(day.end).toISOString()).toBe('2026-10-19T21:00:00.000Z');
    expect(localDate(at, 'Europe/Istanbul')).toBe('2026-10-19');
    // half an hour later it is the next day there
    expect(localDate(at + 1_800_000, 'Europe/Istanbul')).toBe('2026-10-20');
  });

  it('works in UTC too', () => {
    const at = Date.UTC(2026, 0, 1, 0, 0, 1);
    expect(localDay(at, 'UTC')).toEqual({ start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 2) });
  });
});

describe('reward codes', () => {
  it('are 8 unambiguous characters', () => {
    for (let i = 0; i < 200; i++)
      expect(newRewardCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/u);
    expect(new Set(Array.from({ length: 200 }, newRewardCode)).size).toBe(200);
  });

  it('accept what staff type: any case, a dash or spaces; nothing else', () => {
    expect(parseRewardCode('abcd-2345')).toBe('ABCD2345');
    expect(parseRewardCode(' AB CD 23 45 ')).toBe('ABCD2345');
    for (const bad of ['ABCD234', 'ABCD23456', 'ABCD0345', 'OBCD2345', "AB'CD234", ''])
      expect(parseRewardCode(bad)).toBeNull();
  });
});
