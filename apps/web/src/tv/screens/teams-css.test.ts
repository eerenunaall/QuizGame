import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const teamsCss = read('./TvTeams.module.css');
const resultsCss = read('./TvResults.module.css');

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

/** The stage is 1920 x 1080 px; text stays inside the 5 % safe area (x 96..1824, y 54..1026), THEMES.md §2. */
const SAFE = { left: 96, right: 1824, top: 54, bottom: 1026 };

describe('team screens of the TV (stage px, 5 % safe area)', () => {
  it('lets four team rows of the standings fit between the title and the bottom margin', () => {
    const board = rule(teamsCss, '.board');
    const row = rule(teamsCss, '.boardRow');
    expect(px(board.top)).toBeGreaterThanOrEqual(215); // under the 84 px title that starts at 120
    const rows = 4 * (px(row.height) + px(row['margin-bottom']));
    // four rows plus the one-line rule under them end inside the safe area
    expect(px(board.top) + rows + 50).toBeLessThanOrEqual(SAFE.bottom);
    expect(px(board.left) + px(board.width)).toBeLessThanOrEqual(SAFE.right);
    expect(px(board.left)).toBeGreaterThanOrEqual(SAFE.left);
  });

  it('gives the lobby columns a floor of readable, tappable-sized text', () => {
    expect(px(rule(teamsCss, '.teamName')['font-size'])).toBeGreaterThanOrEqual(36);
    expect(px(rule(teamsCss, '.memberName')['font-size'])).toBeGreaterThanOrEqual(30);
    // an eight-player room: four rows of members must fit a column's height budget (< 440 px)
    const head = rule(teamsCss, '.head');
    const member = rule(teamsCss, '.member');
    expect(px(head.height) + 4 * px(member.height) + 40).toBeLessThanOrEqual(440);
  });

  it('keeps the team results list clear of the buttons at the bottom', () => {
    const row = rule(resultsCss, '.playerRow');
    // From the side column's top (215 px): a fourth team's row (78), the list title (38), eight compact
    // player rows, then up to four award lines (44 each) after a 20 px gap.
    const list = 8 * (px(row.height) + px(row['margin-bottom']));
    expect(215 + 78 + 38 + list + 20 + 4 * 44).toBeLessThanOrEqual(SAFE.bottom - 40);
  });
});
