import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { player, roomView, ROUND, you } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { RiskScreen } from './RiskScreen';
import type { RiskChoice } from './powers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LADDER = [
  { tier: 'SAFE', multiplier: 1, loss: 0 },
  { tier: 'RISK', multiplier: 2, loss: 100 },
  { tier: 'HIGH', multiplier: 3, loss: 200 },
] as const;

const prep = (patch: Partial<PhaseDataOf<'RISK_PICK'>> = {}): PhaseDataOf<'RISK_PICK'> => ({
  phase: 'RISK_PICK',
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
  data?: PhaseDataOf<'RISK_PICK'>;
  me?: ReturnType<typeof you>;
  onCommit?: (choice: RiskChoice) => Promise<void>;
  /** The prep window ends at this server time (default 7000, i.e. 5 s after `now`). */
  deadlineAt?: number;
}) {
  const data = options.data ?? prep();
  const room: RoomView = roomView({
    phase: 'RISK_PICK',
    phaseData: data,
    phaseEnteredAt: 1000,
    phaseDeadlineAt: options.deadlineAt ?? 7000,
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
      <RiskScreen room={room} data={data} now={() => 2000} onCommit={onCommit} />
    </I18nProvider>,
  );
  return { onCommit };
}

describe('RiskScreen', () => {
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

  it('commits the stake and the double down in one message', async () => {
    const { onCommit } = mount({});
    fireEvent.click(screen.getByTestId('stake-RISK'));
    fireEvent.click(screen.getByTestId('prep-double-down'));
    fireEvent.click(screen.getByTestId('prep-ready'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({ stake: 'RISK', doubleDown: true });
  });

  it('one big gamble per question: HIGH disables Double Down, and Double Down disables HIGH', () => {
    const data = prep({ doubleDownExcludedStakes: ['HIGH', 'ALL_IN'] });
    mount({ data });
    fireEvent.click(screen.getByTestId('stake-HIGH'));
    expect(screen.getByTestId<HTMLButtonElement>('prep-double-down').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('stake-RISK'));
    expect(screen.getByTestId<HTMLButtonElement>('prep-double-down').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('prep-double-down'));
    expect(screen.getByTestId<HTMLButtonElement>('stake-HIGH').disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>('stake-RISK').disabled).toBe(false);
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

  it('shows what is still in the bag: 50/50 and the shield', () => {
    mount({});
    expect(screen.getByTestId('prep-stock').textContent).toContain('50/50 ×1');
    expect(screen.getByTestId('prep-stock').textContent).toContain('Kalkan ×1');
  });

  it('has a loud title, a one-line rule and a clock, and no sabotage controls', () => {
    mount({});
    expect(screen.getByTestId('pick-title').textContent).toBe('RİSK ZAMANI');
    expect(screen.getByTestId('pick-rule').textContent).toBeTruthy();
    expect(screen.queryByTestId('prep-sabotage')).toBeNull();
  });

  it('never shows the question on the prep screen (the category is all the phone knows)', () => {
    mount({});
    expect(screen.getByTestId('ctl-risk').textContent).toContain('Spor');
    expect(screen.queryByTestId('peek-text')).toBeNull();
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
        commitment: { stake: 'HIGH', doubleDown: true, sabotage: null },
      }),
    });
    expect(screen.getByTestId('ctl-risk-committed').textContent).toContain('Seçimin kilitlendi');
    expect(screen.getByTestId('ctl-risk-committed').textContent).toContain('Yüksek');
    expect(screen.getByTestId('ctl-risk-committed').textContent).toContain('1/3 oyuncu hazır');
    expect(screen.queryByTestId('prep-ready')).toBeNull();
  });
});
