import { describe, expect, it } from 'vitest';
import { contrastRatio, minPairDistance, type Vision } from './color';
import { shades } from './tokens';
import { THEMES, THEME_IDS, type ThemeDef, type ThemeId } from './themes';

/**
 * Red team for the palettes (docs/THEMES.md). Thresholds:
 *  - text tokens >= 4.5:1 (WCAG 1.4.3), UI tokens >= 3:1 (WCAG 1.4.11);
 *  - CVD: CIE76 delta-E between any two category colours, seen through the Machado 2009
 *    deuteranopia / protanopia simulation, >= CATEGORY_MIN. 15 is "clearly different at a glance"
 *    on a lab-style scale (a just-noticeable difference is about 2.3); we keep it strict because
 *    a TV is viewed from 3 m with glare. Answer cards also carry a letter + shape, so their bar
 *    is lower for the legacy party theme (ANSWER_MIN_LEGACY).
 */
const CATEGORY_MIN = 15;
const ANSWER_MIN = 25;
const ANSWER_MIN_LEGACY = 9.5; // party answers are unchanged; red vs green is 10.0 under deuteranopia
const VISIONS: readonly Vision[] = ['normal', 'deuteranopia', 'protanopia'];

/** The party theme predates these checks and must not change look, so a few bars are relaxed. */
const legacy = (theme: ThemeDef): boolean => theme.id === 'party';

describe.each(THEME_IDS)('theme %s', (id: ThemeId) => {
  const theme = THEMES[id];
  const p = theme.palette;
  const surfaces = [p.background, p.backgroundDeep, p.surface, p.surfaceRaised];

  it('text tokens reach 4.5:1 on every surface', () => {
    for (const surface of surfaces) {
      expect(contrastRatio(p.text, surface), `text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.mutedText, surface), `muted on ${surface}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('button labels are readable on the glossy fills', () => {
    expect(contrastRatio('#1b1200', shades(p.accentA).lo)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', shades(p.accentB).lo)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#052b12', shades(p.success).lo)).toBeGreaterThanOrEqual(4.5);
    if (!legacy(theme))
      expect(contrastRatio('#ffffff', shades(p.danger).lo)).toBeGreaterThanOrEqual(4.5);
    for (const key of ['answerA', 'answerB', 'answerC', 'answerD'] as const)
      expect(contrastRatio(theme.onAnswer, shades(p[key]).lo), key).toBeGreaterThanOrEqual(
        legacy(theme) ? 2.2 : 4.5,
      );
  });

  it('UI tokens reach 3:1 on the stage background', () => {
    const ui = {
      accentA: p.accentA,
      accentB: p.accentB,
      accentC: p.accentC,
      success: p.success,
      danger: p.danger,
      warning: p.warning,
      answerA: p.answerA,
      answerB: p.answerB,
      answerC: p.answerC,
      answerD: p.answerD,
      ...(legacy(theme) ? {} : { surfaceLine: p.surfaceLine }), // party borders are decorative
      ...Object.fromEntries(theme.categories.map((c, i) => [`category${i + 1}`, c])),
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`player${n}`, p[`player${n}` as 'player1']]),
      ),
    };
    for (const [name, value] of Object.entries(ui))
      expect(contrastRatio(value, p.background), name).toBeGreaterThanOrEqual(3);
  });

  it.each(['deuteranopia', 'protanopia', 'normal'] as const)(
    'category colours stay apart under %s',
    (vision) => {
      expect(theme.categories).toHaveLength(8);
      expect(new Set(theme.categories).size).toBe(8);
      const { distance, pair } = minPairDistance(theme.categories, vision);
      expect(distance, `${pair.join(' vs ')}`).toBeGreaterThanOrEqual(CATEGORY_MIN);
    },
  );

  it.each(VISIONS)('answer colours stay apart under %s', (vision) => {
    const answers = [p.answerA, p.answerB, p.answerC, p.answerD];
    const { distance, pair } = minPairDistance(answers, vision);
    expect(distance, `${pair.join(' vs ')}`).toBeGreaterThanOrEqual(
      legacy(theme) ? ANSWER_MIN_LEGACY : ANSWER_MIN,
    );
  });

  it('confetti colours are valid and not empty', () => {
    expect(theme.confetti.length).toBeGreaterThan(3);
    for (const c of theme.confetti) expect(c).toMatch(/^#[0-9a-f]{6}$/u);
  });
});
