import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { player, roomView, ROUND, you } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { PrepScreen } from './PrepScreen';
import type { PrepChoice } from './powers';

afterEach(cleanup);

const LADDER = [
  { tier: 'SAFE', multiplier: 1, loss: 0 },
  { tier: 'RISK', multiplier: 2, loss: 100 },
  { tier: 'HIGH', multiplier: 3, loss: 200 },
] as const;

const prep = (patch: Partial<PhaseDataOf<'QUESTION_PREP'>> = {}): PhaseDataOf<'QUESTION_PREP'> => ({
  phase: 'QUESTION_PREP',
  round: { ...ROUND, index: 3, total: 10 },
  category: { id: 'sports', label: 'Spor' },
  difficulty: 'HARD',
  riskLadder: LADDER.map((rung) => ({ ...rung })),
  stakeMandatory: false,
  doubleDownEnabled: true,
  sabotageEnabled: true,
  committedCount: 1,
  eligibleCount: 3,
  ...patch,
});

const powers = (patch: Record<string, unknown> = {}) => ({
  fiftyFifty: 1,
  doubleDown: 2,
  shield: 1,
  sabotageTokens: 1,
  nextTokenAtStreak: 3,
  lockedJoker: null,
  ...patch,
});

function mount(options: {
  data?: PhaseDataOf<'QUESTION_PREP'>;
  me?: ReturnType<typeof you>;
  onCommit?: (choice: PrepChoice) => Promise<void>;
}) {
  const data = options.data ?? prep();
  const room: RoomView = roomView({
    phase: 'QUESTION_PREP',
    phaseData: data,
    phaseEnteredAt: 1000,
    phaseDeadlineAt: 7000,
    players: [
      player(0, { nickname: 'Ece' }),
      player(1, { nickname: 'Ahmet' }),
      player(2, { nickname: 'Merve' }),
    ],
    you: options.me ?? you('p1', { powers: powers() }),
  });
  const onCommit = options.onCommit ?? vi.fn(() => Promise.resolve());
  render(
    <I18nProvider locale="tr">
      <PrepScreen room={room} data={data} now={() => 2000} onCommit={onCommit} />
    </I18nProvider>,
  );
  return { onCommit };
}

describe('PrepScreen', () => {
  it('shows the ladder with its rules and starts on the lowest rung', () => {
    mount({});
    expect(screen.getByTestId('stake-SAFE').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('stake-RISK').textContent).toContain('×2');
    expect(screen.getByTestId('stake-RISK').textContent).toContain('−100');
    expect(screen.getByTestId('stake-SAFE').textContent).toContain('kayıp yok');
    fireEvent.click(screen.getByTestId('stake-HIGH'));
    expect(screen.getByTestId('stake-HIGH').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('stake-SAFE').getAttribute('aria-checked')).toBe('false');
  });

  it('commits the stake, the double down and no sabotage in one message', async () => {
    const { onCommit } = mount({});
    fireEvent.click(screen.getByTestId('stake-RISK'));
    fireEvent.click(screen.getByTestId('prep-double-down'));
    fireEvent.click(screen.getByTestId('prep-ready'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({ stake: 'RISK', doubleDown: true, sabotage: null });
  });

  it('cannot double down when none are left or the joker is locked out', () => {
    mount({ me: you('p1', { powers: powers({ doubleDown: 0 }) }) });
    expect(screen.getByTestId<HTMLButtonElement>('prep-double-down').disabled).toBe(true);
    expect(screen.getByTestId('prep-double-down').textContent).toContain('Hakkın bitti');
    cleanup();
    mount({ me: you('p1', { powers: powers({ lockedJoker: 'DOUBLE_DOWN' }) }) });
    expect(screen.getByTestId<HTMLButtonElement>('prep-double-down').disabled).toBe(true);
    expect(screen.getByTestId('prep-double-down').textContent).toContain('Bu tur kilitli');
  });

  it('picks a sabotage target and effect in a sheet, and commits it', async () => {
    const { onCommit } = mount({});
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    expect(screen.getByTestId('sabotage-sheet')).toBeTruthy();
    expect(screen.queryByTestId('sabotage-target-Ahmet')).toBeNull(); // not myself
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    fireEvent.click(screen.getByTestId('sabotage-effect-FOG'));
    expect(screen.queryByTestId('sabotage-sheet')).toBeNull();
    expect(screen.getByTestId('prep-sabotage').textContent).toContain('Sis → Merve');
    fireEvent.click(screen.getByTestId('prep-ready'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit).toHaveBeenCalledWith({
      stake: 'SAFE',
      doubleDown: false,
      sabotage: { targetId: 'p2', effect: 'FOG' },
    });
  });

  it('asks which joker to lock for a lockout', async () => {
    const { onCommit } = mount({});
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Ece'));
    fireEvent.click(screen.getByTestId('sabotage-effect-LOCKOUT'));
    expect(screen.getByTestId('sabotage-joker-DOUBLE_DOWN')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sabotage-joker-FIFTY_FIFTY'));
    fireEvent.click(screen.getByTestId('prep-ready'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit).toHaveBeenCalledWith({
      stake: 'SAFE',
      doubleDown: false,
      sabotage: { targetId: 'p0', effect: 'LOCKOUT', joker: 'FIFTY_FIFTY' },
    });
  });

  it('lets a chosen sabotage be removed again, and hides sabotage when it is closed', () => {
    mount({});
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    fireEvent.click(screen.getByTestId('sabotage-effect-JAM'));
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-remove'));
    expect(screen.getByTestId('prep-sabotage').textContent).not.toContain('Merve');
    cleanup();
    mount({ data: prep({ sabotageEnabled: false }) });
    expect(screen.queryByTestId('prep-sabotage')).toBeNull();
  });

  it('explains how to earn a token when there is none', () => {
    mount({ me: you('p1', { powers: powers({ sabotageTokens: 0 }) }) });
    const button = screen.getByTestId<HTMLButtonElement>('prep-sabotage');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('3 doğru seriyle jeton kazan');
  });

  it('shows the server refusal in plain words and lets the player try again', async () => {
    const failure = Object.assign(new Error('refused'), { code: 'STAKE_INVALID' });
    const onCommit = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    mount({ onCommit });
    fireEvent.click(screen.getByTestId('prep-ready'));
    await waitFor(() =>
      expect(screen.getByTestId('prep-error').textContent).toBe('Bu bahis seçilemez.'),
    );
    const button = screen.getByTestId<HTMLButtonElement>('prep-ready');
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
  });

  it('makes the stake mandatory on the last question', () => {
    mount({
      data: prep({
        stakeMandatory: true,
        riskLadder: [
          { tier: 'RISK', multiplier: 2, loss: 150 },
          { tier: 'HIGH', multiplier: 3, loss: 250 },
          { tier: 'ALL_IN', multiplier: 5, loss: 400 },
        ],
      }),
    });
    expect(screen.queryByTestId('stake-SAFE')).toBeNull();
    expect(screen.getByTestId('stake-RISK').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Son soru! Bahis zorunlu.')).toBeTruthy();
  });

  it('after committing shows what was chosen and how many are ready, and cannot be changed', () => {
    mount({
      me: you('p1', {
        powers: powers(),
        commitment: {
          stake: 'HIGH',
          doubleDown: true,
          sabotage: { targetId: 'p2', effect: 'POINT_TAX' },
        },
      }),
    });
    expect(screen.getByTestId('ctl-prep-committed').textContent).toContain('Seçimin kilitlendi');
    expect(screen.getByTestId('ctl-prep-committed').textContent).toContain('Yüksek');
    expect(screen.getByTestId('ctl-prep-committed').textContent).toContain('Vergi → Merve');
    expect(screen.getByTestId('ctl-prep-committed').textContent).toContain('1/3 oyuncu hazır');
    expect(screen.queryByTestId('prep-ready')).toBeNull();
  });
});
