import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createState,
  execute,
  teamBadge,
  tvView,
  type Command,
  type QState,
  type QuizConfig,
} from '@quizparty/quiznight';
import { I18nProvider } from '../../lib/i18n';
import type { NightView } from './NightTv';
import { NightSlide } from './Slides';

/** The TV slides, driven by the real engine's allow-listed view (no hand-made frames). */
const q = (id: string, points = 1) => ({
  id,
  text: `Soru ${id}?`,
  options: ['Bir', 'İki', 'Üç', 'Dört'],
  answer: { type: 'OPTION' as const, index: 2 },
  explanation: `Açıklama ${id}`,
  points,
  jokerAllowed: true,
});
const config: QuizConfig = {
  title: 'Cuma Gecesi',
  date: '2026-11-06',
  rounds: [{ id: 'r1', kind: 'NORMAL', title: 'Genel kültür', questions: [q('a'), q('b')] }],
  tieBreak: null,
  teams: [1, 2, 3].map((n) => ({
    id: `t${n}`,
    name: `Takım ${n}`,
    badge: teamBadge(n),
    table: n,
  })),
  settings: {
    jokersPerTeam: 2,
    wrongDoublePenalty: false,
    timerSec: 30,
    halfTimeAfterRound: 0,
    entranceText: 'Giriş 100 TL',
    prizeText: 'Bir içecek',
  },
};

function play(...cmds: Command[]): QState {
  let s = createState(config);
  for (const cmd of cmds) {
    const o = execute(s, cmd, { now: 1000, actor: 'h' });
    if (!o.ok) throw new Error(`${cmd.type}: ${o.error}`);
    s = o.state;
  }
  return s;
}
const next = (n: number): Command[] => Array.from({ length: n }, () => ({ type: 'NEXT' }));
const view = (s: QState): NightView => ({ ...tvView(s, 1000), venueName: 'Gusto Cafe' });

function show(s: QState, secondsLeft: number | null = null) {
  return render(
    <I18nProvider locale="tr">
      <NightSlide view={view(s)} secondsLeft={secondsLeft} />
    </I18nProvider>,
  );
}
afterEach(cleanup);

describe('Quiz night TV slides', () => {
  it('intro shows the title, the entrance price and the prize', () => {
    const { container } = show(play({ type: 'START' }));
    expect(container.textContent).toContain('Cuma Gecesi');
    expect(container.textContent).toContain('Giriş: Giriş 100 TL');
    expect(container.textContent).toContain('Ödül: Bir içecek');
  });

  it('a question shows the options and the 2x banner with the team, never the answer', () => {
    const s = play(
      { type: 'START' },
      { type: 'JOKER', questionId: 'a', teamId: 't2', on: true },
      ...next(3),
    );
    const { container } = show(s, 12);
    expect(screen.getByTestId('night-question').textContent).toBe('Soru a?');
    expect(screen.getByTestId('night-doubled').textContent).toContain('Takım 2 ÇİFT PUAN dedi!');
    expect(screen.getByTestId('night-timer').textContent).toBe('12');
    expect(container.querySelector('[data-testid="night-answer"]')).toBeNull();
    expect(container.textContent).not.toContain('Açıklama');
  });

  it('pens down, paper swap with the rotation, then the answer with its explanation', () => {
    let s = play({ type: 'START' }, ...next(5));
    expect(show(s).container.textContent).toContain('Kalemler bırakılsın!');
    cleanup();
    s = play({ type: 'START' }, ...next(6));
    show(s);
    expect(screen.getByTestId('night-rotation').textContent).toContain('Masa 1 → Masa 2');
    expect(screen.getByTestId('night-rotation').textContent).toContain('Masa 3 → Masa 1');
    cleanup();
    s = play({ type: 'START' }, ...next(7));
    show(s);
    expect(screen.getByTestId('night-answer').textContent).toContain('Üç');
    expect(screen.getByTestId('night-option-2')).toBeTruthy();
    expect(document.body.textContent).toContain('Açıklama a');
    expect(document.body.textContent).not.toContain('Açıklama b');
  });

  it('standings show rank changes and remaining jokers; the podium names the winner', () => {
    const s = play(
      { type: 'START' },
      { type: 'JOKER', questionId: 'a', teamId: 't1', on: true },
      ...next(6),
      { type: 'MARK', questionId: 'a', teamId: 't1', right: true },
      ...next(5),
    );
    // intro, how-to, title, 2 questions, pens down, swap, 2 answers, marking, scores, standings
    expect(tvView(s, 0).step).toBe('STANDINGS');
    show(s);
    const first = screen.getByTestId('night-standings').querySelector('li')!;
    expect(first.textContent).toContain('Takım 1');
    expect(first.textContent).toContain('1 joker');
    cleanup();
    show(play({ type: 'START' }, ...next(12)));
    expect(screen.getByTestId('night-podium').textContent).toContain('kazandı!');
  });
});

describe('Quiz night TV CSS guard (stage px, 5 % safe area)', () => {
  const css = readFileSync(join(process.cwd(), 'apps/web/src/tv/night/night.module.css'), 'utf8');
  const rule = (selector: string): Record<string, string> => {
    const match = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
    if (!match) throw new Error(`no rule for ${selector}`);
    const out: Record<string, string> = {};
    for (const line of match[1]!.replace(/\/\*[\s\S]*?\*\//gu, '').split(';')) {
      const at = line.indexOf(':');
      if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return out;
  };
  const px = (v: string | undefined): number => Number.parseFloat(v ?? 'NaN');

  it('is authored at 1920x1080 and keeps content inside the 5 % safe area', () => {
    const screenRule = rule('.screen');
    expect(px(screenRule.width)).toBe(1920);
    expect(px(screenRule.height)).toBe(1080);
    const safe = rule('.safe');
    expect(px(safe.left)).toBeGreaterThanOrEqual(96);
    expect(px(safe.top)).toBeGreaterThanOrEqual(54);
    expect(px(safe.left) + px(safe.width)).toBeLessThanOrEqual(1920 - 96);
    expect(px(safe.top) + px(safe.height)).toBeLessThanOrEqual(1080 - 54);
  });

  it('uses TV-readable type (nothing under 28 px) and no viewport units', () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/gu)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
    expect(css).not.toMatch(/\d(vw|vh|rem)\b/u);
  });

  it('positions banners inside the safe box (a positioned ancestor), never on the screen edge', () => {
    expect(rule('.banners').position).toBe('absolute');
    expect(rule('.safe').position).toBe('absolute');
  });
});
