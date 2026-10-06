/**
 * Brand tokens shared by the TV display, the browser controller and the native app (GDD §33).
 * The web build consumes the generated `tokens.css` (strict CSP forbids injecting <style> at
 * runtime); React Native reads the same values from this object.
 */
export const colors = {
  background: '#0b0820',
  backgroundDeep: '#06041a',
  surface: '#17123a',
  surfaceRaised: '#221a52',
  surfaceLine: '#3a2f7a',
  text: '#ffffff',
  mutedText: '#b9b2e8',
  accentA: '#ff3d8b',
  accentB: '#2de2e6',
  accentC: '#ffd23f',
  success: '#35e08a',
  danger: '#ff5470',
  warning: '#ffb020',
  /** Answer cards: colour + shape + letter, so nothing is conveyed by colour alone. */
  answerA: '#ff3d8b',
  answerB: '#2de2e6',
  answerC: '#ffd23f',
  answerD: '#8b5cf6',
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
export const fonts = {
  display: "'Titan One', 'Fredoka', system-ui, sans-serif",
  body: "'Fredoka', system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;
export const shadows = {
  card: '0 10px 0 rgba(0, 0, 0, 0.35), 0 24px 48px rgba(0, 0, 0, 0.45)',
  glow: '0 0 40px rgba(255, 61, 139, 0.55)',
  inset: 'inset 0 -6px 0 rgba(0, 0, 0, 0.22)',
} as const;

export const ANSWER_SHAPES = ['triangle', 'diamond', 'circle', 'square'] as const;
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

const kebab = (name: string): string =>
  name.replace(/[A-Z0-9]/g, (match) => `-${match.toLowerCase()}`);

/** `:root { --qp-… }` declarations for every token. */
export function cssVariables(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(colors))
    lines.push(`  --qp-color-${kebab(name)}: ${value};`);
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
