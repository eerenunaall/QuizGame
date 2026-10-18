import { colors, paletteDeclarations, cssVariables, type Palette } from './tokens';

/**
 * Selectable themes (docs/THEMES.md). `party` is the base palette in tokens.ts and stays the
 * `:root` default, so existing screens do not change; the others override the same variables under
 * `:root[data-theme='…']`. Fonts, radii and spacing are shared on purpose: a venue font is an owner
 * input that arrives later via `--qp-font-*`.
 */
export const THEME_IDS = ['party', 'venue-gold', 'high-contrast'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeDef {
  id: ThemeId;
  palette: Palette;
  /** Eight category accent colours (CVD-checked), used for category chips and player slots. */
  categories: readonly string[];
  /** Label colour on the glossy answer cards. */
  onAnswer: string;
  /** rgba glow around the primary action and the leader. */
  glow: string;
  /** `<meta name="theme-color">` (browser chrome). */
  chrome: string;
  /** Confetti and burst colours follow the theme. */
  confetti: readonly string[];
}

export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);

// Answer colours for the two accessible themes: an Okabe & Ito-derived set (docs/THEMES.md).
const OKABE_ANSWERS = {
  answerA: '#f4793f',
  answerB: '#56b4e9',
  answerC: '#f0e442',
  answerD: '#1fb88a',
} as const;

const SAFE_CATEGORIES = [
  '#f0e442',
  '#e8602c',
  '#7fd4ff',
  '#1fb88a',
  '#e58fbf',
  '#3a78d8',
  '#ffffff',
  '#8a5a2b',
] as const;

export const partyTheme: ThemeDef = {
  id: 'party',
  palette: colors,
  categories: [
    '#ffd60a',
    '#ff6a2b',
    '#7fd4ff',
    '#2fe36e',
    '#ff5fc8',
    '#3a78d8',
    '#ffffff',
    '#8a5a2b',
  ],
  onAnswer: '#ffffff',
  glow: '0 0 40px rgba(255, 201, 40, 0.5)',
  chrome: colors.background,
  confetti: ['#ffc928', '#8f3dff', '#f23e5a', '#2f8bff', '#25c85a', '#2de2e6', '#ffffff'],
};

const venueGoldPalette: Palette = {
  background: '#0c0b09',
  backgroundDeep: '#050504',
  surface: '#1a1814',
  surfaceRaised: '#26231c',
  surfaceLine: '#7a6a3a',
  text: '#fbf6ea',
  mutedText: '#c9bfa5',
  accentA: '#d4af37',
  accentB: '#7d5a1c',
  accentC: '#f1d98a',
  success: '#3ddc84',
  danger: '#e04848',
  warning: '#f5a623',
  ...OKABE_ANSWERS,
  player1: SAFE_CATEGORIES[0],
  player2: SAFE_CATEGORIES[1],
  player3: SAFE_CATEGORIES[2],
  player4: SAFE_CATEGORIES[3],
  player5: SAFE_CATEGORIES[4],
  player6: SAFE_CATEGORIES[5],
  player7: '#f4ead0',
  player8: SAFE_CATEGORIES[7],
};

export const venueGoldTheme: ThemeDef = {
  id: 'venue-gold',
  palette: venueGoldPalette,
  categories: [...SAFE_CATEGORIES.slice(0, 6), '#f4ead0', SAFE_CATEGORIES[7]],
  onAnswer: '#0c0b09',
  glow: '0 0 40px rgba(212, 175, 55, 0.45)',
  chrome: venueGoldPalette.background,
  confetti: ['#d4af37', '#f1d98a', '#fbf6ea', '#e8602c', '#56b4e9', '#1fb88a'],
};

const highContrastPalette: Palette = {
  background: '#000000',
  backgroundDeep: '#000000',
  surface: '#121212',
  surfaceRaised: '#1f1f1f',
  surfaceLine: '#bdbdbd',
  text: '#ffffff',
  mutedText: '#e6e6e6',
  accentA: '#ffd400',
  accentB: '#6a4fd0',
  accentC: '#7fd4ff',
  success: '#3ddc84',
  danger: '#e04848',
  warning: '#ffb000',
  ...OKABE_ANSWERS,
  player1: SAFE_CATEGORIES[0],
  player2: SAFE_CATEGORIES[1],
  player3: SAFE_CATEGORIES[2],
  player4: SAFE_CATEGORIES[3],
  player5: SAFE_CATEGORIES[4],
  player6: SAFE_CATEGORIES[5],
  player7: SAFE_CATEGORIES[6],
  player8: SAFE_CATEGORIES[7],
};

export const highContrastTheme: ThemeDef = {
  id: 'high-contrast',
  palette: highContrastPalette,
  categories: SAFE_CATEGORIES,
  onAnswer: '#000000',
  glow: '0 0 32px rgba(255, 212, 0, 0.6)',
  chrome: '#000000',
  confetti: ['#ffd400', '#7fd4ff', '#e8602c', '#1fb88a', '#ffffff'],
};

export const THEMES: Record<ThemeId, ThemeDef> = {
  party: partyTheme,
  'venue-gold': venueGoldTheme,
  'high-contrast': highContrastTheme,
};

const extras = (theme: ThemeDef): Record<string, string> => ({
  ...Object.fromEntries(
    theme.categories.map((value, index) => [`color-category-${index + 1}`, value]),
  ),
  'color-on-answer': theme.onAnswer,
  'shadow-glow': theme.glow,
});

/** Full stylesheet: base tokens, party extras, then one override block per non-default theme. */
export function themeCss(): string {
  const blocks = [
    `:root {\n${Object.entries(extras(partyTheme))
      .filter(([name]) => name !== 'shadow-glow')
      .map(([name, value]) => `  --qp-${name}: ${value};`)
      .join('\n')}\n}\n`,
  ];
  for (const theme of [venueGoldTheme, highContrastTheme])
    blocks.push(
      `:root[data-theme='${theme.id}'] {\n${paletteDeclarations(theme.palette, extras(theme)).join('\n')}\n}\n`,
    );
  return blocks.join('');
}

export function fullCss(): string {
  return cssVariables() + themeCss();
}
