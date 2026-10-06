import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseDataOf } from '@quizparty/protocol';
import { player, roomView, ROUND } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../../lib/i18n';
import { TvQuestion, MAX_CHOOSER_FACES } from './TvQuestion';
import { SETTLE_MS, TvScoreUpdate } from './TvScore';

const wrap = (node: React.ReactElement) => render(<I18nProvider locale="tr">{node}</I18nProvider>);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TvScoreUpdate', () => {
  const players = [
    player(0, { nickname: 'Ece' }),
    player(1, { nickname: 'Ahmet' }),
    player(2, { nickname: 'Merve' }),
  ];
  // Round 2: Ahmet (200 → 380) overtakes Ece (300), Merve (100 → 270) stays third.
  const data: PhaseDataOf<'SCORE_UPDATE'> = {
    phase: 'SCORE_UPDATE',
    round: ROUND,
    deltas: [
      { playerId: 'p0', delta: 0, total: 300, rank: 2, previousRank: 1, components: [] },
      { playerId: 'p1', delta: 180, total: 380, rank: 1, previousRank: 2, components: [] },
      { playerId: 'p2', delta: 170, total: 270, rank: 3, previousRank: 3, components: [] },
    ],
    scoreboard: [],
  };
  const room = roomView({ players, phase: 'SCORE_UPDATE', phaseData: data });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  const crowns = () => document.querySelectorAll('img[data-sticker="crown"]').length;
  const order = () =>
    Array.from(document.querySelectorAll('[data-testid^="score-row-"]')).map((row) =>
      row.getAttribute('data-testid')?.replace('score-row-', ''),
    );

  it('starts in the previous order, then settles into the new order and moves the crown', () => {
    wrap(<TvScoreUpdate room={room} data={data} />);
    expect(order()).toEqual(['Ece', 'Ahmet', 'Merve']);
    expect(crowns()).toBe(1); // the old leader wears it until the rows settle
    expect(screen.getByTestId('score-row-Ece').getAttribute('data-rank')).toBe('1');
    act(() => void vi.advanceTimersByTime(SETTLE_MS + 10));
    expect(order()).toEqual(['Ahmet', 'Ece', 'Merve']);
    expect(crowns()).toBe(1);
    expect(screen.getByTestId('score-row-Ahmet').getAttribute('data-rank')).toBe('1');
    expect(screen.getByTestId('score-row-Ece').getAttribute('data-rank')).toBe('2');
  });

  it('shows no crown while everyone is still on zero', () => {
    const zero: PhaseDataOf<'SCORE_UPDATE'> = {
      ...data,
      deltas: data.deltas.map((entry) => ({
        ...entry,
        delta: 0,
        total: 0,
        rank: 1,
        previousRank: 1,
      })),
    };
    wrap(<TvScoreUpdate room={room} data={zero} />);
    expect(crowns()).toBe(0);
    act(() => void vi.advanceTimersByTime(SETTLE_MS + 10));
    expect(crowns()).toBe(0);
  });

  it('announces a rank change once and is not restarted by parent re-renders', () => {
    const onRankChange = vi.fn();
    const { rerender } = wrap(
      <TvScoreUpdate room={room} data={data} onRankChange={onRankChange} />,
    );
    // The TV app passes a brand-new inline callback on every render (and renders often: pings,
    // player status). Re-rendering twice per settle period must not keep resetting the timer.
    for (let i = 0; i < 4; i++) {
      act(() => void vi.advanceTimersByTime(SETTLE_MS / 2));
      rerender(
        <I18nProvider locale="tr">
          <TvScoreUpdate room={room} data={data} onRankChange={() => void onRankChange()} />
        </I18nProvider>,
      );
    }
    expect(order()[0]).toBe('Ahmet'); // settled after SETTLE_MS in total
    expect(onRankChange).toHaveBeenCalledTimes(1);
  });

  it('does not announce anything when nobody moved up', () => {
    const still: PhaseDataOf<'SCORE_UPDATE'> = {
      ...data,
      deltas: data.deltas.map((entry, index) => ({
        ...entry,
        rank: index + 1,
        previousRank: index + 1,
      })),
    };
    const onRankChange = vi.fn();
    wrap(<TvScoreUpdate room={room} data={still} onRankChange={onRankChange} />);
    act(() => void vi.advanceTimersByTime(SETTLE_MS + 10));
    expect(onRankChange).not.toHaveBeenCalled();
  });
});

describe('TvQuestion reveal', () => {
  const options = [
    { optionId: 'optionAAAA', text: 'Ankara' },
    { optionId: 'optionBBBB', text: 'İstanbul' },
    { optionId: 'optionCCCC', text: 'İzmir' },
    { optionId: 'optionDDDD', text: 'Bursa' },
  ];
  const players = Array.from({ length: 6 }, (_, i) => player(i, { nickname: `Oyuncu${i}` }));
  const room = roomView({ players });

  const reveal = (explanation: string | null, picks: (string | null)[]) => ({
    correctOptionId: 'optionAAAA',
    distribution: [],
    results: picks.map((optionId, i) => ({ playerId: `p${i}`, optionId })),
    explanation,
  });

  it('shows the explanation card with its heading, and the question text stays for screen readers', () => {
    wrap(
      <TvQuestion
        room={room}
        text="Türkiye'nin başkenti neresidir?"
        options={options}
        reveal={reveal("Ankara, 1923'te başkent oldu.", [])}
      />,
    );
    const card = screen.getByTestId('tv-explanation');
    expect(within(card).getByText('Biliyor muydunuz?')).toBeTruthy();
    expect(card.textContent).toContain('1923');
    expect(screen.getByTestId('tv-question').textContent).toContain('başkenti');
  });

  it('shows no explanation card when there is none (or it is blank)', () => {
    for (const explanation of [null, '   ']) {
      const { unmount } = wrap(
        <TvQuestion room={room} text="Soru?" options={options} reveal={reveal(explanation, [])} />,
      );
      expect(screen.queryByTestId('tv-explanation')).toBeNull();
      unmount();
    }
  });

  it('puts at most three faces on a card and folds the rest into a +N chip', () => {
    wrap(
      <TvQuestion
        room={room}
        text="Soru?"
        options={options}
        reveal={reveal(null, [
          'optionAAAA',
          'optionAAAA',
          'optionAAAA',
          'optionAAAA',
          'optionAAAA',
          'optionBBBB',
        ])}
      />,
    );
    const groups = screen.getAllByTestId('tv-choosers');
    expect(groups).toHaveLength(2);
    const [crowded, single] = groups;
    expect(crowded!.querySelectorAll('img').length + 1).toBe(MAX_CHOOSER_FACES); // 2 faces + the chip
    expect(crowded!.textContent).toBe('+3');
    expect(single!.querySelectorAll('img').length).toBe(1);
    expect(single!.textContent).toBe('');
  });

  it('shows the answer options only while there are options and marks the correct one', () => {
    wrap(<TvQuestion room={room} text="Soru?" options={options} reveal={reveal(null, [])} />);
    const grid = screen.getByTestId('tv-options');
    expect(grid.querySelectorAll('[data-answer-index]')).toHaveLength(4);
  });
});
