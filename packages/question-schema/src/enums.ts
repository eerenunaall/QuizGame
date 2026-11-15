import { DIFFICULTIES, LOCALES, type Difficulty, type Locale } from '@quizparty/protocol/constants';

/** Content languages of the bank. Equal to the UI locales we ship (ADR-0016). */
export const QUESTION_LANGUAGES = LOCALES;
export type QuestionLanguage = Locale;

export { DIFFICULTIES };
export type { Difficulty };

export const POOLS = ['EVERGREEN', 'CURRENT'] as const;
export type Pool = (typeof POOLS)[number];

export const AUTHOR_TYPES = ['HUMAN', 'AI_ASSISTED', 'AI_DRAFT', 'DEV_SEED'] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

/** Lifecycle of a question (GDD §9.5). Only ACTIVE questions are ever served to players. */
export const QUESTION_STATUSES = [
  'DRAFT',
  'GENERATED',
  'NORMALIZED',
  'DUPLICATE_CHECK',
  'FACT_CHECK',
  'ANSWER_CHECK',
  'AMBIGUITY_CHECK',
  'LANGUAGE_QA',
  'DIFFICULTY_CALIBRATION',
  'GAMEPLAY_REVIEW',
  'APPROVED',
  'ACTIVE',
  'REVIEW',
  'RETIRED',
  'REJECTED',
] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const VERIFICATION_STATUSES = ['UNVERIFIED', 'VERIFIED', 'DISPUTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Option positions are 0-based; four is the standard party-game shape, two to six are accepted. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const STANDARD_OPTIONS = 4;
export const QUESTION_TEXT_MIN = 10;
export const QUESTION_TEXT_MAX = 400;
export const OPTION_TEXT_MAX = 160;
export const EXPLANATION_MAX = 600;

/** The seventeen launch categories (GDD §9.4) with their stable ids and labels. */
export const LAUNCH_CATEGORIES = [
  { id: 'general', tr: 'Genel Kültür', en: 'General Knowledge', free: true, sourceRequired: false },
  { id: 'history', tr: 'Tarih', en: 'History', free: true, sourceRequired: true },
  { id: 'geography', tr: 'Coğrafya', en: 'Geography', free: true, sourceRequired: true },
  { id: 'science', tr: 'Bilim', en: 'Science', free: true, sourceRequired: true },
  { id: 'nature', tr: 'Doğa', en: 'Nature', free: true, sourceRequired: true },
  { id: 'technology', tr: 'Teknoloji', en: 'Technology', free: true, sourceRequired: true },
  {
    id: 'art-culture',
    tr: 'Sanat ve Kültür',
    en: 'Art & Culture',
    free: true,
    sourceRequired: true,
  },
  { id: 'literature', tr: 'Edebiyat', en: 'Literature', free: true, sourceRequired: true },
  { id: 'cinema-tv', tr: 'Sinema ve Dizi', en: 'Cinema & TV', free: true, sourceRequired: true },
  { id: 'music', tr: 'Müzik', en: 'Music', free: true, sourceRequired: true },
  { id: 'gaming', tr: 'Oyun', en: 'Gaming', free: true, sourceRequired: true },
  { id: 'sports', tr: 'Spor', en: 'Sports', free: true, sourceRequired: true },
  { id: 'food-drink', tr: 'Yeme İçme', en: 'Food & Drink', free: true, sourceRequired: false },
  {
    id: 'mythology-folklore',
    tr: 'Mitoloji ve Folklor',
    en: 'Mythology & Folklore',
    free: true,
    sourceRequired: true,
  },
  {
    id: 'language-words',
    tr: 'Dil ve Kelimeler',
    en: 'Language & Words',
    free: true,
    sourceRequired: false,
  },
  {
    id: 'business-economy',
    tr: 'İş ve Ekonomi',
    en: 'Business & Economy',
    free: true,
    sourceRequired: true,
  },
  {
    id: 'math-logic',
    tr: 'Matematik ve Mantık',
    en: 'Math & Logic',
    free: true,
    sourceRequired: false,
  },
] as const;
export type LaunchCategoryId = (typeof LAUNCH_CATEGORIES)[number]['id'];
