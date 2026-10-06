import type { AuditSubject } from './heuristics';

/**
 * Test support shared by this package, the bank and the server: a fixed clock and a builder for
 * audit subjects. Exported as `@quizparty/question-schema/fixtures`.
 */
export const NOW = new Date('2026-10-06T12:00:00Z');
export const RECENT = new Date('2026-09-20T00:00:00Z');

export interface Draft {
  text: string;
  options: string[];
  correct: number;
}

/** A question with sane defaults: Turkish, evergreen, verified a few weeks ago, one source. */
export function subject(draft: Draft, overrides: Partial<AuditSubject> = {}): AuditSubject {
  return {
    language: 'tr',
    category: 'geography',
    difficulty: 'MEDIUM',
    text: draft.text,
    explanation: 'Kısa bir açıklama.',
    options: draft.options.map((text, index) => ({ text, correct: index === draft.correct })),
    pool: 'EVERGREEN',
    expiresAt: null,
    lastVerifiedAt: RECENT,
    sourceCount: 1,
    authorType: 'HUMAN',
    ...overrides,
  };
}

/** Hand-written Turkish questions that must pass every deterministic check without a flag. */
export const GOOD: { name: string; draft: Draft; overrides?: Partial<AuditSubject> }[] = [
  {
    name: 'geography',
    draft: {
      text: 'Nil Nehri hangi kıtada yer alır?',
      options: ['Afrika', 'Asya', 'Güney Amerika', 'Avrupa'],
      correct: 0,
    },
  },
  {
    name: 'science',
    draft: {
      text: 'Suyun kimyasal formülü nedir?',
      options: ['H2O', 'CO2', 'O2', 'NaCl'],
      correct: 0,
    },
    overrides: { category: 'science', difficulty: 'EASY' },
  },
  {
    name: 'history',
    draft: {
      text: 'Türkiye Cumhuriyeti hangi yıl ilan edilmiştir?',
      options: ['1919', '1920', '1923', '1938'],
      correct: 2,
    },
    overrides: { category: 'history' },
  },
  {
    name: 'sports',
    draft: {
      text: 'Bir futbol takımı sahaya kaç oyuncuyla çıkar?',
      options: ['9', '10', '11', '12'],
      correct: 2,
    },
    overrides: { category: 'sports', difficulty: 'EASY' },
  },
  {
    name: 'art',
    draft: {
      text: 'Mona Lisa tablosunu hangi sanatçı yapmıştır?',
      options: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Sandro Botticelli'],
      correct: 1,
    },
    overrides: { category: 'art-culture' },
  },
  {
    name: 'literature',
    draft: {
      text: 'Çalıkuşu romanının yazarı kimdir?',
      options: [
        'Yakup Kadri Karaosmanoğlu',
        'Halide Edib Adıvar',
        'Reşat Nuri Güntekin',
        'Peyami Safa',
      ],
      correct: 2,
    },
    overrides: { category: 'literature' },
  },
  {
    name: 'music',
    draft: {
      text: 'Standart bir piyanoda kaç tuş bulunur?',
      options: ['61', '76', '88', '92'],
      correct: 2,
    },
    overrides: { category: 'music', difficulty: 'EASY' },
  },
  {
    name: 'nature',
    draft: {
      text: 'Aşağıdaki hayvanlardan hangisi bir sürüngendir?',
      options: ['Yunus', 'Timsah', 'Penguen', 'Yarasa'],
      correct: 1,
    },
    overrides: { category: 'nature', difficulty: 'EASY' },
  },
  {
    name: 'technology',
    draft: {
      text: 'HTML kısaltması ne anlama gelir?',
      options: [
        'HyperText Markup Language',
        'High Transfer Machine Language',
        'Hyper Tool Multi Language',
        'Home Text Mark Language',
      ],
      correct: 0,
    },
    overrides: { category: 'technology' },
  },
  {
    name: 'food',
    draft: {
      text: 'Türk kahvesi geleneksel olarak hangi kapta pişirilir?',
      options: ['Güveç', 'Tava', 'Cezve', 'Tencere'],
      correct: 2,
    },
    overrides: { category: 'food-drink', difficulty: 'EASY' },
  },
  {
    name: 'math',
    draft: {
      text: 'Bir üçgenin iç açılarının toplamı kaç derecedir?',
      options: ['90', '180', '270', '360'],
      correct: 1,
    },
    overrides: { category: 'math-logic', difficulty: 'EASY' },
  },
  {
    name: 'gaming',
    draft: {
      text: 'Super Mario oyun serisinin kahramanı Mario hangi mesleği yapar?',
      options: ['Aşçı', 'Doktor', 'Tesisatçı', 'İtfaiyeci'],
      correct: 2,
    },
    overrides: { category: 'gaming' },
  },
];
