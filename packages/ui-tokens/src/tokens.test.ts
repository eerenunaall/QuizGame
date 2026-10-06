import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  answerColors,
  colors,
  cssVariables,
  fonts,
  gradients,
  mix,
  playerColor,
  playerColors,
  shades,
} from './tokens';

/** WCAG relative luminance contrast ratio. */
function contrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    ) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (a + 0.05) / (b + 0.05);
}

describe('design tokens', () => {
  it('the committed tokens.css is generated from tokens.ts (no drift)', () => {
    const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
    expect(css).toBe(cssVariables());
  });

  it('keeps text readable on the stage background (contrast ≥ 4.5:1, large text ≥ 3:1)', () => {
    expect(contrast(colors.text, colors.background)).toBeGreaterThan(12);
    expect(contrast(colors.mutedText, colors.background)).toBeGreaterThan(4.5);
    expect(contrast(colors.mutedText, colors.surface)).toBeGreaterThan(4.5);
    for (const color of playerColors)
      expect(contrast(color, colors.background), color).toBeGreaterThan(3);
    for (const color of answerColors)
      expect(contrast(color, colors.background), color).toBeGreaterThan(3);
  });

  it('has eight distinct player colours and clamps slots', () => {
    expect(new Set(playerColors).size).toBe(8);
    expect(playerColor(1)).toBe(colors.player1);
    expect(playerColor(8)).toBe(colors.player8);
    expect(playerColor(99)).toBe(colors.player8);
    expect(playerColor(0)).toBe(colors.player1);
  });

  it('derives highlight, shade and lip colours that stay on the same hue family', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
    const { hi, lo, edge } = shades(colors.answerA);
    expect(contrast(hi, colors.background)).toBeGreaterThan(
      contrast(colors.answerA, colors.background),
    );
    expect(contrast(lo, colors.background)).toBeLessThan(
      contrast(colors.answerA, colors.background),
    );
    expect(contrast(edge, colors.background)).toBeLessThan(contrast(lo, colors.background));
    expect(gradients.answerA).toContain(hi);
    expect(gradients.answerA).toContain(lo);
  });

  it('puts the answer colours in distinct hue families and keeps white labels readable on them', () => {
    expect(new Set(answerColors).size).toBe(4);
    // white letter badges and answer text sit on the glossy lower half of the card
    for (const color of answerColors)
      expect(contrast('#ffffff', shades(color).lo)).toBeGreaterThan(2.2);
  });

  it('names only fonts that carry the Turkish alphabet', () => {
    expect(fonts.display).toContain('Paytone One');
    expect(fonts.body).toContain('Baloo 2');
    expect(`${fonts.display}${fonts.body}`).not.toMatch(/Fredoka|Titan/u);
  });
});
