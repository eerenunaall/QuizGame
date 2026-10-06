import { z } from 'zod';
import {
  AVATAR_IDS,
  CLOSE_REASONS,
  DIFFICULTIES,
  DIFFICULTY_PRESETS,
  JOKERS,
  LOCALES,
  MAX_NICKNAME_LENGTH,
  MIN_NICKNAME_LENGTH,
  PHASES,
  RISK_TIERS,
  ROUND_KINDS,
  SABOTAGE_KINDS,
  TIERS,
} from './constants';

export const UuidSchema = z.uuid();
export const EpochMsSchema = z.int().nonnegative();
export const SequenceSchema = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Per-presentation random id: carries no information about correctness or database order. */
export const OptionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/);
export const QuestionIdSchema = z.string().min(1).max(64);
export const PlayerIdSchema = z.string().min(1).max(64);
export const AvatarIdSchema = z.enum(AVATAR_IDS);
export const CategoryIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);
export const DeviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Shape-only; semantic nickname rules (scripts, confusables, profanity) live in packages/validation. */
export const NicknameSchema = z
  .string()
  .min(MIN_NICKNAME_LENGTH)
  .max(MAX_NICKNAME_LENGTH * 4);

export const PhaseSchema = z.enum(PHASES);
export const DifficultySchema = z.enum(DIFFICULTIES);
export const DifficultyPresetSchema = z.enum(DIFFICULTY_PRESETS);
export const RoundKindSchema = z.enum(ROUND_KINDS);
export const RiskTierSchema = z.enum(RISK_TIERS);
export const JokerSchema = z.enum(JOKERS);
export const SabotageKindSchema = z.enum(SABOTAGE_KINDS);
export const TierSchema = z.enum(TIERS);
export const LocaleSchema = z.enum(LOCALES);
export const CloseReasonSchema = z.enum(CLOSE_REASONS);
export const ConnectionSchema = z.enum(['CONNECTED', 'DISCONNECTED']);

export const ClientInfoSchema = z.strictObject({
  kind: z.enum(['WEB', 'IOS', 'ANDROID', 'DISPLAY']),
  version: z.string().max(32),
  locale: LocaleSchema.optional(),
});
export type ClientInfo = z.infer<typeof ClientInfoSchema>;

/** Parameters accompanying an error code (e.g. `{ retryAfterMs: 1500 }`); never prose. */
export const ErrorParamsSchema = z.record(
  z.string().max(32),
  z.union([z.string().max(64), z.number()]),
);
