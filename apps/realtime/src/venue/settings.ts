import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { MAX_TEAM_NAME_LENGTH, PLAY_MODES, TEAM_IDS } from '@quizparty/protocol';
import { ROOM_CODE_ALPHABET } from '@quizparty/shared';
import { sanitizeUserText } from '@quizparty/validation';

/**
 * A venue's settings (ADR-0024 §2). Stored as jsonb; every key has a default so a venue created with
 * `{}` (or an older shape) reads as a complete, valid object, and a write is validated in full.
 */
/** The fields, without defaults: a patch must never fill in what the owner did not send. */
const rewardFields = {
  enabled: z.boolean(),
  text: z.string().trim().max(120),
  minPlayers: z.int().min(2).max(8),
  maxPerDay: z.int().min(0).max(500),
  rematchCooldownMinutes: z.int().min(0).max(240),
};
const minutesField = z.int().min(5).max(720);
const stepsField = z.array(z.int().min(1).max(240)).min(1).max(4);
const zoneField = z
  .string()
  .max(64)
  .refine((zone) => validTimeZone(zone), 'unknown time zone');

export const RewardSettingsSchema = z.strictObject({
  enabled: rewardFields.enabled.default(false),
  text: rewardFields.text.default(''),
  minPlayers: rewardFields.minPlayers.default(3),
  maxPerDay: rewardFields.maxPerDay.default(10),
  rematchCooldownMinutes: rewardFields.rematchCooldownMinutes.default(5),
});

/** Where a venue room draws its questions from (ADR-0025 §8). */
export const QUESTION_SOURCES = ['MIXED', 'VENUE_ONLY', 'GLOBAL_ONLY'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];
const questionFields = {
  source: z.enum(QUESTION_SOURCES),
  venueSharePercent: z.int().min(5).max(95),
};
export const QuestionSettingsSchema = z.strictObject({
  source: questionFields.source.default('MIXED'),
  venueSharePercent: questionFields.venueSharePercent.default(30),
});

/**
 * How a venue's tables start (ADR-0026 §7): individual or team play, the simple ruleset, the venue's own
 * names for the team slots (empty string = the default name of that slot, at most one per slot) and the
 * café answer window in seconds for the ordinary question kinds.
 */
const playFields = {
  defaultMode: z.enum(PLAY_MODES),
  simpleRuleset: z.boolean(),
  teamNames: z.array(z.string().trim().max(MAX_TEAM_NAME_LENGTH)).max(TEAM_IDS.length),
  /** Null = the deployment's own number (`GAME_CONFIG_OVERRIDE`, default 30 s). */
  simpleAnswerSeconds: z.int().min(10).max(60).nullable(),
};
export const PlaySettingsSchema = z.strictObject({
  defaultMode: playFields.defaultMode.default('INDIVIDUAL'),
  simpleRuleset: playFields.simpleRuleset.default(false),
  teamNames: playFields.teamNames.default([]),
  simpleAnswerSeconds: playFields.simpleAnswerSeconds.default(null),
});

export const VenueSettingsSchema = z.strictObject({
  reward: RewardSettingsSchema.default(RewardSettingsSchema.parse({})),
  questions: QuestionSettingsSchema.default(QuestionSettingsSchema.parse({})),
  play: PlaySettingsSchema.default(PlaySettingsSchema.parse({})),
  defaultMinutes: minutesField.default(60),
  extendSteps: stepsField.default([15, 30, 60]),
  timezone: zoneField.default('Europe/Istanbul'),
});
export type VenueSettings = z.infer<typeof VenueSettingsSchema>;

/** What an owner may send: any subset, merged over the stored settings and validated as a whole. */
export const VenueSettingsPatchSchema = z.strictObject({
  reward: z.strictObject(rewardFields).partial().optional(),
  questions: z.strictObject(questionFields).partial().optional(),
  play: z.strictObject(playFields).partial().optional(),
  defaultMinutes: minutesField.optional(),
  extendSteps: stepsField.optional(),
  timezone: zoneField.optional(),
});

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Stored settings, defaults filled in; a row that does not parse falls back to the defaults (never to "on"). */
export function readSettings(stored: unknown): VenueSettings {
  const parsed = VenueSettingsSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : VenueSettingsSchema.parse({});
}

export function mergeSettings(
  current: VenueSettings,
  patch: z.infer<typeof VenueSettingsPatchSchema>,
): VenueSettings | null {
  const merged = VenueSettingsSchema.safeParse({
    ...current,
    ...patch,
    reward: { ...current.reward, ...(patch.reward ?? {}) },
    questions: { ...current.questions, ...(patch.questions ?? {}) },
    play: { ...current.play, ...(patch.play ?? {}) },
  });
  if (!merged.success) return null;
  // Names go on the TV for everybody: the same text screening as anything else a person typed, and no
  // two slots with the same name.
  const names = sanitizeTeamNames(merged.data.play.teamNames);
  if (names === null) return null;
  merged.data.play.teamNames = names;
  // An enabled reward needs words to show: an empty text would hand out a code for nothing.
  if (merged.data.reward.enabled && merged.data.reward.text.length === 0) return null;
  return merged.data;
}

/**
 * Screens the owner's team names (ADR-0026 §7): normalized, no links, profanity or hidden characters, and
 * no two equal (an empty entry keeps the slot's default name). Null when any name is refused.
 */
export function sanitizeTeamNames(names: readonly string[]): string[] | null {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (name.trim() === '') {
      out.push('');
      continue;
    }
    const checked = sanitizeUserText(name, { maxLength: MAX_TEAM_NAME_LENGTH });
    if (!checked.ok) return null;
    const key = checked.text.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) return null;
    seen.add(key);
    out.push(checked.text);
  }
  // Trailing empty slots say nothing.
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * The venue's local day around `at`: [start, end) in epoch ms. Rewards expire at `end`, and the daily
 * cap counts from `start`. DST is ignored (a day is 24 h from local midnight); Türkiye has none.
 */
export function localDay(at: number, timeZone: string): { start: number; end: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offset = wall - Math.floor(at / 1000) * 1000;
  const start = Date.UTC(get('year'), get('month') - 1, get('day')) - offset;
  return { start, end: start + 86_400_000 };
}

/** The local calendar date (YYYY-MM-DD) of `at` in `timeZone`. */
export function localDate(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/** Reward codes: 8 characters of the room-code alphabet (no 0/O, 1/I/L), about 40 bits. */
export const REWARD_CODE_LENGTH = 8;

export function newRewardCode(): string {
  let code = '';
  for (let i = 0; i < REWARD_CODE_LENGTH; i++)
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** What staff typed (any case, spaces or a dash in the middle) as a code, or null when it cannot be one. */
export function parseRewardCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/gu, '');
  if (code.length !== REWARD_CODE_LENGTH) return null;
  for (const char of code) if (!ROOM_CODE_ALPHABET.includes(char)) return null;
  return code;
}

export type VenuePatch = z.infer<typeof VenueSettingsPatchSchema>;
