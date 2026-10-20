/**
 * The curated prompts a Blind Quiz creator can pick from (ADR-0015). Each key has a prompt for the
 * person who answers and a question template for the game, both in `packages/i18n`
 * (`blind.catalog.<key>.prompt` / `.question`). Deliberately harmless: nothing that asks for sensitive
 * personal data (GDD §11.6).
 */
export const BLIND_CATALOG_KEYS = [
  'dreamJob',
  'dislikedFood',
  'firstConcert',
  'embarrassing',
  'surprisingHobby',
  'childhoodCartoon',
  'dreamHoliday',
  'firstDevice',
  'skillToLearn',
  'rewatchMovie',
  'childhoodNickname',
  'freeSunday',
] as const;
export type BlindCatalogKey = (typeof BLIND_CATALOG_KEYS)[number];

export const BLIND_LIMITS = {
  /** A personal answer or a decoy, in characters. */
  answerMax: 140,
  decoysMax: 3,
  promptsMax: 20,
  /** Prompts a quiz needs before it can be played, and targets one quiz may have. */
  playableMin: 3,
  targetsMax: 6,
  quizzesPerAccount: 10,
  customQuestionsMax: 50,
} as const;
