import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const lobbyCss = read('./TvLobby.module.css');
const interstitialsCss = read('./TvInterstitials.module.css');
const resultsCss = read('./TvResults.module.css');

/**
 * jsdom lays nothing out, so these pin the declarations whose absence was seen on a 1080p screen
 * (QA screenshots of a six-player Turkish table). Each comment says what broke.
 */
function rule(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  const declarations: Record<string, string> = {};
  for (const line of match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const at = line.indexOf(':');
    if (at > 0) declarations[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return declarations;
}
const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN');

describe('TV lobby player tile', () => {
  // `overflow: hidden` lets a flex item shrink to nothing: with a LİDER / HAZIR badge under it the
  // leader's name was squashed to a few clipped pixels.
  it('never lets the name shrink under its badge', () => {
    expect(rule(lobbyCss, '.name').flex).toBe('none');
    expect(rule(lobbyCss, '.name').overflow).toBe('hidden');
  });

  it('draws the badge over the foot of the avatar instead of in a row of its own', () => {
    const badge = rule(lobbyCss, '.badge');
    expect(badge.position).toBe('absolute');
    expect(rule(lobbyCss, '.slot').position).toBe('relative');
    // inside the tile: avatar (150) + padding (20) = 170, the badge straddles that line
    expect(px(badge.top)).toBeLessThan(170);
    expect(px(badge.top)).toBeGreaterThan(100);
  });
});

describe('TV pick screens', () => {
  // RİSK ZAMANI / SABOTAJ ZAMANI slid under the round pill, the Exit button and the room code.
  it('start below the top bar (80 px bar at y 44, so 124)', () => {
    const screen = rule(interstitialsCss, '.pickScreen');
    expect(px(screen.top)).toBeGreaterThanOrEqual(124);
    // and still end inside the 90 % safe area (972 px) of a 1080 p screen plus the strip it never shows
    expect(px(screen.top) + px(screen.height)).toBeLessThanOrEqual(1026);
  });
});

describe('TV results', () => {
  // SONUÇLAR sat under the Exit button (y 54 to 112).
  it('puts the title clear of the Exit button', () => {
    const title = rule(resultsCss, '.title');
    expect(px(title.top)).toBeGreaterThanOrEqual(100);
    // the first-place crown starts at about y 180
    expect(px(title.top) + px(title['font-size'])).toBeLessThanOrEqual(190);
  });
});
