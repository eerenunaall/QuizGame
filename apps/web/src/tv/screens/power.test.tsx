import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseDataOf } from '@quizparty/protocol';
import { player, roomView, ROUND } from '@quizparty/controller-client/fixtures';
import { sfx } from '../../lib/audio';
import { I18nProvider } from '../../lib/i18n';
import { TvPrep } from './TvInterstitials';
import { TvPowerResolution, itemDelay } from './TvPower';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const players = [
  player(0, { nickname: 'Ece' }),
  player(1, { nickname: 'Ahmet' }),
  player(2, { nickname: 'Merve' }),
];
const room = roomView({ players });
const wrap = (node: React.ReactElement) => render(<I18nProvider locale="tr">{node}</I18nProvider>);

describe('TvPrep', () => {
  const data: PhaseDataOf<'QUESTION_PREP'> = {
    phase: 'QUESTION_PREP',
    round: { ...ROUND, kind: 'RISK' },
    category: { id: 'sports', label: 'Spor' },
    difficulty: 'HARD',
    riskLadder: [
      { tier: 'SAFE', multiplier: 1, loss: 0 },
      { tier: 'RISK', multiplier: 2, loss: 200 },
      { tier: 'HIGH', multiplier: 3, loss: 300 },
    ],
    stakeMandatory: false,
    doubleDownEnabled: true,
    sabotageEnabled: true,
    committedCount: 2,
    eligibleCount: 4,
  };

  it('shows the category, the ladder, the powers on offer and how many have decided', () => {
    wrap(<TvPrep data={data} now={() => 2000} startAt={1000} deadlineAt={9000} />);
    expect(screen.getByTestId('tv-prep').textContent).toContain('Spor');
    expect(screen.getByTestId('tv-prep').textContent).toContain('RİSK TURU');
    const ladder = screen.getByTestId('tv-ladder').textContent ?? '';
    expect(ladder).toContain('×3');
    expect(ladder).toContain('yanlışta −300');
    expect(ladder).toContain('kayıp yok');
    expect(screen.getByTestId('tv-prep').textContent).toContain('Sabotaj açık');
    expect(screen.getByTestId('tv-prep').textContent).toContain('Çifte Hak açık');
    expect(screen.getByTestId('tv-prep-ready').textContent).toBe('2/4 hazır');
  });

  it('says when a stake is a must, and hides powers that are not on offer', () => {
    wrap(
      <TvPrep
        data={{ ...data, stakeMandatory: true, doubleDownEnabled: false, sabotageEnabled: false }}
        now={() => 2000}
        startAt={1000}
        deadlineAt={null}
      />,
    );
    expect(screen.getByTestId('tv-prep').textContent).toContain('Son soru: bahis zorunlu!');
    expect(screen.getByTestId('tv-prep').textContent).not.toContain('Sabotaj açık');
    expect(screen.getByTestId('tv-prep').textContent).not.toContain('Çifte Hak açık');
  });
});

describe('TvPowerResolution', () => {
  const data: PhaseDataOf<'POWER_RESOLUTION'> = {
    phase: 'POWER_RESOLUTION',
    round: ROUND,
    items: [
      { kind: 'STAKE', playerId: 'p0', tier: 'HIGH', outcome: 'CORRECT' },
      { kind: 'DOUBLE_DOWN', playerId: 'p0', outcome: 'CORRECT' },
      { kind: 'FIFTY_FIFTY', playerId: 'p1', outcome: 'INCORRECT' },
      { kind: 'SABOTAGE', actorId: 'p1', targetId: 'p2', effect: 'FOG', blocked: false },
      { kind: 'SABOTAGE', actorId: 'p2', targetId: 'p0', effect: 'JAM', blocked: true },
    ],
  };

  it('names every move with who made it and how it went', () => {
    wrap(<TvPowerResolution room={room} data={data} />);
    const cards = screen.getAllByTestId('power-item');
    expect(cards.map((card) => card.getAttribute('data-kind'))).toEqual([
      'STAKE',
      'DOUBLE_DOWN',
      'FIFTY_FIFTY',
      'SABOTAGE',
      'SABOTAGE',
    ]);
    expect(cards[0]!.textContent).toContain('Ece Yüksek oynadı');
    expect(cards[0]!.textContent).toContain('DOĞRU');
    expect(cards[1]!.textContent).toContain('Ece ÇİFTE yaptı');
    expect(cards[2]!.textContent).toContain('Ahmet 50/50 kullandı');
    expect(cards[2]!.textContent).toContain('YANLIŞ');
    expect(cards[3]!.textContent).toContain('Sis');
    expect(cards[3]!.textContent).toContain('Ahmet → Merve');
    expect(cards[3]!.textContent).toContain('Tam isabet!');
    expect(cards[4]!.getAttribute('data-blocked')).toBe('true');
    expect(cards[4]!.textContent).toContain('KALKAN engelledi!');
  });

  it('plays a sound per item on the same beat as the reveal', () => {
    vi.useFakeTimers();
    const play = vi.spyOn(sfx, 'play').mockImplementation(() => undefined);
    wrap(<TvPowerResolution room={room} data={data} />);
    expect(play).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(itemDelay(data.items.length - 1) + 5));
    expect(play.mock.calls.map(([name]) => name)).toEqual([
      'power',
      'power',
      'power',
      'hit',
      'shield',
    ]);
  });

  beforeEach(() => {
    vi.useRealTimers();
  });
});
