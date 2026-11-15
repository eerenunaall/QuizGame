import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color';
import { ACCENTS, ACCENT_IDS, THEMES, accentVariables } from './themes';

/** The closed accent palette a venue may pick from (ADR-0030 §2). */
describe('venue accent palette', () => {
  it('is closed and every entry is a plain #rrggbb', () => {
    expect(Object.keys(ACCENTS).sort()).toEqual([...ACCENT_IDS].sort());
    for (const hex of Object.values(ACCENTS)) expect(hex).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it.each(ACCENT_IDS)('%s reads on every theme background and carries dark labels', (id) => {
    const hex = ACCENTS[id];
    for (const theme of Object.values(THEMES)) {
      expect(contrastRatio(hex, theme.palette.background), theme.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hex, theme.palette.surface), theme.id).toBeGreaterThanOrEqual(4.5);
    }
    const vars = accentVariables(id);
    expect(vars['--qp-color-accent-a']).toBe(hex);
    expect(vars['--qp-gradient-gold']).toContain(hex);
    expect(contrastRatio('#0b0a08', hex)).toBeGreaterThanOrEqual(7);
  });
});
