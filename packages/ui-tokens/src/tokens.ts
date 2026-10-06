/**
 * Brand tokens shared by the TV display, the browser controller and the native app (GDD §33).
 * The web build consumes the generated `tokens.css` (strict CSP forbids injecting <style> at
 * runtime); React Native reads the same values from this object. Direction: a dark navy "game-show
 * stage" with gold and violet accents and four vivid answer colours (ADR-0020).
 */
export const colors = {
  background: '#060d2e',
  backgroundDeep: '#030820',
  surface: '#0f1d52',
  surfaceRaised: '#172a70',
  surfaceLine: '#2e4596',
  text: '#ffffff',
  mutedText: '#aebbf0',
  /** Gold: primary call to action, the leader's crown, the countdown ring. */
  accentA: '#ffc928',
  /** Violet: secondary actions, highlights, the winner's row. */
  accentB: '#8f3dff',
  accentC: '#2de2e6',
  success: '#2fe36e',
  danger: '#ff4766',
  warning: '#ffa41f',
  /** Answer cards: colour + letter badge, so nothing is conveyed by colour alone. */
  answerA: '#f23e5a',
  answerB: '#2f8bff',
  answerC: '#ffc22a',
  answerD: '#25c85a',
  player1: '#ff6b6b',
  player2: '#4dd0e1',
  player3: '#ffd166',
  player4: '#06d6a0',
  player5: '#a78bfa',
  player6: '#f78c6b',
  player7: '#5aa9ff',
  player8: '#ff8fd8',
} as const;

export const radius = { sm: 10, md: 18, lg: 28, xl: 40, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 } as const;
export const durations = { fast: 120, base: 240, slow: 480, stage: 900 } as const;

/**
 * Both families cover every Turkish letter (İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü). Fredoka and Titan One were
 * rejected for lacking Ş, Ğ and İ.
 */
export const fonts = {
  display: "'Paytone One', 'Baloo 2', system-ui, sans-serif",
  body: "'Baloo 2', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

export const shadows = {
  card: '0 8px 0 rgba(0, 0, 0, 0.35), 0 22px 44px rgba(0, 0, 0, 0.45)',
  glow: '0 0 40px rgba(255, 201, 40, 0.5)',
  inset: 'inset 0 -6px 0 rgba(0, 0, 0, 0.22)',
  soft: '0 10px 30px rgba(0, 0, 0, 0.35)',
} as const;

export const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const answerColors = [
  colors.answerA,
  colors.answerB,
  colors.answerC,
  colors.answerD,
] as const;
export const playerColors = [
  colors.player1,
  colors.player2,
  colors.player3,
  colors.player4,
  colors.player5,
  colors.player6,
  colors.player7,
  colors.player8,
] as const;

/** Player colour for a 1-based colour slot. */
export function playerColor(slot: number): string {
  return playerColors[Math.max(0, Math.min(playerColors.length - 1, slot - 1))]!;
}

/** Linear mix of two #rrggbb colours (`amount` 0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const channel = (hex: string, index: number): number =>
    parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const out = [0, 1, 2].map((index) =>
    Math.round(channel(a, index) + (channel(b, index) - channel(a, index)) * amount),
  );
  return `#${out.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Highlight, shade and bottom-lip variants used by the glossy, chunky buttons and cards. */
export function shades(base: string): { hi: string; lo: string; edge: string } {
  return {
    hi: mix(base, '#ffffff', 0.3),
    lo: mix(base, '#000000', 0.2),
    edge: mix(base, '#000000', 0.45),
  };
}

const SHADED = [
  'accentA',
  'accentB',
  'success',
  'danger',
  'answerA',
  'answerB',
  'answerC',
  'answerD',
] as const satisfies readonly (keyof typeof colors)[];

const glossy = (base: string): string => {
  const shade = shades(base);
  return `linear-gradient(180deg, ${shade.hi} 0%, ${base} 52%, ${shade.lo} 100%)`;
};

export const gradients = {
  stage: `radial-gradient(1400px 800px at 50% -15%, ${colors.surfaceRaised} 0%, ${colors.background} 58%, ${colors.backgroundDeep} 100%)`,
  panel: `linear-gradient(180deg, ${colors.surfaceRaised} 0%, ${colors.surface} 100%)`,
  gold: glossy(colors.accentA),
  violet: glossy(colors.accentB),
  success: glossy(colors.success),
  danger: glossy(colors.danger),
  answerA: glossy(colors.answerA),
  answerB: glossy(colors.answerB),
  answerC: glossy(colors.answerC),
  answerD: glossy(colors.answerD),
} as const;

const kebab = (name: string): string =>
  name.replace(/[A-Z0-9]/g, (match) => `-${match.toLowerCase()}`);

/** `:root { --qp-… }` declarations for every token. */
export function cssVariables(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(colors))
    lines.push(`  --qp-color-${kebab(name)}: ${value};`);
  for (const name of SHADED) {
    const shade = shades(colors[name]);
    lines.push(`  --qp-color-${kebab(name)}-hi: ${shade.hi};`);
    lines.push(`  --qp-color-${kebab(name)}-lo: ${shade.lo};`);
    lines.push(`  --qp-color-${kebab(name)}-edge: ${shade.edge};`);
  }
  for (const [name, value] of Object.entries(gradients))
    lines.push(`  --qp-gradient-${kebab(name)}: ${value};`);
  for (const [name, value] of Object.entries(radius))
    lines.push(`  --qp-radius-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(spacing))
    lines.push(`  --qp-space-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(durations))
    lines.push(`  --qp-duration-${name}: ${value}ms;`);
  for (const [name, value] of Object.entries(fonts)) lines.push(`  --qp-font-${name}: ${value};`);
  for (const [name, value] of Object.entries(shadows))
    lines.push(`  --qp-shadow-${name}: ${value};`);
  return `/* Generated from tokens.ts by build-css.ts — do not edit. */\n:root {\n${lines.join('\n')}\n}\n`;
}
