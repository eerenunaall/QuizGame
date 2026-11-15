import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const controllerCss = read('./Controller.module.css');
const cardCss = read('../ui/AnswerCard.module.css');
const frameCss = read('./PhoneFrame.module.css');
const peekCss = read('./QuestionPeek.module.css');

const SHORT_PORTRAIT = '@media (orientation: portrait) and (max-height: 700px)';

/** The body of a media block, found by brace matching (the blocks hold nested rules). */
function block(css: string, query: string): string {
  const start = css.indexOf(`${query} {`);
  if (start < 0) throw new Error(`no ${query} block`);
  let depth = 0;
  for (let at = css.indexOf('{', start); at < css.length; at++) {
    if (css[at] === '{') depth++;
    if (css[at] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, at);
  }
  throw new Error('unbalanced block');
}
function declarations(body: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(body);
  if (!match) throw new Error(`no rule for ${selector}`);
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(';')) {
    const at = line.indexOf(':');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}
const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN');

/**
 * At 360x640 the real page is about 540 px tall once the browser bar is counted. The roomy layout
 * needs about 680, so the fourth answer sat under the fold of a timed question (QA screenshots at
 * 320x568 and 360x640). jsdom lays nothing out: these pin the compact rules.
 */
describe('short portrait phones', () => {
  it('shrink the answer cards, but never below a comfortable thumb target', () => {
    const option = declarations(block(controllerCss, SHORT_PORTRAIT), '.option');
    const card = declarations(block(cardCss, SHORT_PORTRAIT), '.phone');
    for (const height of [px(option['min-height']), px(card['min-height'])]) {
      expect(height).toBeLessThan(72);
      expect(height).toBeGreaterThanOrEqual(56);
    }
    expect(px(option['margin-bottom'])).toBeLessThan(12);
  });

  it('tighten the header and the hint so the cards get the room', () => {
    expect(
      px(declarations(block(frameCss, SHORT_PORTRAIT), '.header')['padding-top']),
    ).toBeLessThan(26);
    expect(declarations(block(peekCss, SHORT_PORTRAIT), '.hint').padding).toBe('0');
  });
});
