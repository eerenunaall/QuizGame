import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const entranceCss = read('./EntranceLine.module.css');
const lobbyCss = read('../tv/screens/TvLobby.module.css');
const timeUpCss = read('./TvVenueTimeUp.module.css');

function rule(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  const out: Record<string, string> = {};
  for (const line of match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const at = line.indexOf(':');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}
const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN');

/**
 * jsdom lays nothing out; these pin the stage rules of the TV (ADR-0030): a 1920x1080 stage in stage
 * pixels, text kept inside the 5 % safe area (96 px left/right, 54 px top/bottom), readable from the couch.
 */
describe('the TV entrance card', () => {
  it('uses stage pixels, never viewport units', () => {
    const tv = entranceCss.slice(0, entranceCss.indexOf('.phone {'));
    for (const css of [tv, lobbyCss, timeUpCss])
      expect(css).not.toMatch(/\d(?:vh|vw|vmin|vmax)\b/u);
  });

  it('is large enough to read from a table across the room', () => {
    expect(px(rule(entranceCss, '.tvText')['font-size'])).toBeGreaterThanOrEqual(36);
    expect(px(rule(entranceCss, '.tvNote')['font-size'])).toBeGreaterThanOrEqual(24);
    expect(px(rule(entranceCss, '.tvLabel')['font-size'])).toBeGreaterThanOrEqual(24);
  });

  it('fits inside the lobby join card, which ends inside the safe area', () => {
    const card = rule(lobbyCss, '.join');
    expect(px(card.left)).toBeGreaterThanOrEqual(96 - 6);
    expect(px(card.left) + px(card.width)).toBeLessThanOrEqual(1920 - 96);
    expect(px(card.top) + px(card.height)).toBeLessThanOrEqual(1080 - 54);
    // card inner width = width - 2 x 28 padding
    expect(px(rule(entranceCss, '.tv').width)).toBeLessThanOrEqual(px(card.width) - 56);
  });

  it('keeps the time-up screen block inside the safe area', () => {
    const screen = rule(timeUpCss, '.screen');
    expect(px(screen.top)).toBeGreaterThanOrEqual(54);
    expect(px(screen.top) + px(screen.height)).toBeLessThanOrEqual(1080 - 54);
  });
});
