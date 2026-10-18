import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { player, roomView, ROUND, you } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { PrepScreen } from './PrepScreen';
import type { PrepChoice } from './powers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
  /** The prep window ends at this server time (default 7000, i.e. 5 s after `now`). */
  deadlineAt?: number;
}) {
  const data = options.data ?? prep();
  const room: RoomView = roomView({
    phase: 'QUESTION_PREP',
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

  it('sabotage: chip, a face, a card, one big button; the commit goes out after a 2 s undo window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onCommit } = mount({ deadlineAt: 30_000 });
    const chip = screen.getByTestId('prep-sabotage');
    expect(chip.textContent).toContain('Sabotaj');
    expect(chip.textContent).toContain('1 jeton');
    fireEvent.click(chip);
    expect(screen.getByTestId('sabotage-sheet').getAttribute('data-step')).toBe('who');
    expect(screen.queryByTestId('sabotage-target-Ahmet')).toBeNull(); // not myself
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    // all five real types, each with its one-line effect
    for (const kind of ['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX'])
      expect(screen.getByTestId(`sabotage-effect-${kind}`)).toBeTruthy();
    expect(screen.getByTestId('sabotage-effect-FOG').textContent).toContain('Sis');
    expect(screen.getByTestId('sabotage-effect-FOG').textContent).toContain(
      'Bir seçenek kısa süre gizlenir.',
    );
    // grey until a card is picked, and it says why
    const confirm = screen.getByTestId<HTMLButtonElement>('sabotage-confirm');
    expect(confirm.disabled).toBe(true);
    expect(screen.getByTestId('sabotage-why').textContent).toBe('Önce bir sabotaj seç');
    fireEvent.click(screen.getByTestId('sabotage-effect-FOG'));
    expect(confirm.disabled).toBe(false);
    expect(screen.getByTestId('sabotage-why').textContent).toContain(
      'Bahsin de bununla kilitlenir',
    );
    fireEvent.click(confirm);

    // the sheet is gone; the sabotage waits two seconds and can still be taken back
    expect(screen.queryByTestId('sabotage-sheet')).toBeNull();
    expect(screen.getByTestId('sabotage-going').textContent).toContain('Sis → Merve');
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      stake: 'SAFE',
      doubleDown: false,
      sabotage: { targetId: 'p2', effect: 'FOG' },
    });
  });

  it('undo during the window sends nothing and gives the chip back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onCommit } = mount({ deadlineAt: 30_000 });
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    fireEvent.click(screen.getByTestId('sabotage-effect-JAM'));
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    fireEvent.click(screen.getByTestId('sabotage-undo'));
    expect(screen.queryByTestId('sabotage-going')).toBeNull();
    expect(screen.getByTestId('prep-sabotage').textContent).not.toContain('Merve');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('with almost no prep time left the sabotage goes out at once (an undo window would eat the commit)', async () => {
    const { onCommit } = mount({ deadlineAt: 3000 }); // now() is 2000: one second left
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Ece'));
    fireEvent.click(screen.getByTestId('sabotage-effect-POINT_TAX'));
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({
      stake: 'SAFE',
      doubleDown: false,
      sabotage: { targetId: 'p0', effect: 'POINT_TAX' },
    });
  });

  it('the sabotage carries the stake and Double Down chosen before it (one commit)', async () => {
    const { onCommit } = mount({ deadlineAt: 3000 });
    fireEvent.click(screen.getByTestId('stake-RISK'));
    fireEvent.click(screen.getByTestId('prep-double-down'));
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    fireEvent.click(screen.getByTestId('sabotage-effect-SHUFFLE'));
    expect(screen.getByTestId('sabotage-why').textContent).toContain('Risk + Çifte Hak');
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit).toHaveBeenCalledWith({
      stake: 'RISK',
      doubleDown: true,
      sabotage: { targetId: 'p2', effect: 'SHUFFLE' },
    });
  });

  it('asks which joker to lock for a lockout, and stays grey until one is picked', async () => {
    const { onCommit } = mount({ deadlineAt: 3000 });
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Ece'));
    fireEvent.click(screen.getByTestId('sabotage-effect-LOCKOUT'));
    expect(screen.getByTestId<HTMLButtonElement>('sabotage-confirm').disabled).toBe(true);
    expect(screen.getByTestId('sabotage-why').textContent).toBe('Kilitlenecek jokeri seç');
    expect(screen.getByTestId('sabotage-joker-DOUBLE_DOWN')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sabotage-joker-FIFTY_FIFTY'));
    expect(screen.getByTestId<HTMLButtonElement>('sabotage-confirm').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit).toHaveBeenCalledWith({
      stake: 'SAFE',
      doubleDown: false,
      sabotage: { targetId: 'p0', effect: 'LOCKOUT', joker: 'FIFTY_FIFTY' },
    });
  });

  it('a refused sabotage is dropped, explained, and the chip says it is cooling down', async () => {
    const failure = Object.assign(new Error('refused'), { code: 'SABOTAGE_LIMIT' });
    const onCommit = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    mount({ onCommit, deadlineAt: 3000 });
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    fireEvent.click(screen.getByTestId('sabotage-effect-JAM'));
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('prep-error').textContent).toBe(
        'Sabotaj sınırına ulaştın. Biraz bekle.',
      ),
    );
    const chip = screen.getByTestId<HTMLButtonElement>('prep-sabotage');
    expect(chip.disabled).toBe(true);
    expect(chip.textContent).toContain('Bekleme süresinde');
    // the rest of the prep still goes out without it
    const ready = screen.getByTestId<HTMLButtonElement>('prep-ready');
    await waitFor(() => expect(ready.disabled).toBe(false));
    fireEvent.click(ready);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(onCommit).toHaveBeenLastCalledWith({ stake: 'SAFE', doubleDown: false, sabotage: null });
  });

  it('after a failure that is not about sabotage the choice stays armed and can be taken back', async () => {
    const failure = Object.assign(new Error('offline'), { code: 'INTERNAL' });
    const onCommit = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    mount({ onCommit, deadlineAt: 3000 });
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    fireEvent.click(screen.getByTestId('sabotage-effect-JAM'));
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    await waitFor(() => expect(screen.getByTestId('prep-error')).toBeTruthy());
    expect(screen.getByTestId('prep-sabotage').textContent).toContain('Süre kes → Merve');
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    expect(screen.getByTestId('sabotage-sheet').getAttribute('data-step')).toBe('what');
    fireEvent.click(screen.getByTestId('sabotage-remove'));
    expect(screen.queryByTestId('sabotage-sheet')).toBeNull();
    expect(screen.getByTestId('prep-sabotage').textContent).not.toContain('Merve');
  });

  it('a back step lets the player change the face, and the chip stays when sabotage is closed', () => {
    mount({});
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    expect(screen.getByTestId('sabotage-target-chosen').textContent).toContain('Merve');
    fireEvent.click(screen.getByTestId('sabotage-back'));
    expect(screen.getByTestId('sabotage-sheet').getAttribute('data-step')).toBe('who');
    fireEvent.click(screen.getByTestId('sabotage-close'));
    expect(screen.queryByTestId('sabotage-sheet')).toBeNull();
  });

  it('explains in one line why sabotage is off: no token, a closed round, the final', () => {
    mount({ me: you('p1', { powers: powers({ sabotageTokens: 0 }) }) });
    let chip = screen.getByTestId<HTMLButtonElement>('prep-sabotage');
    expect(chip.disabled).toBe(true);
    expect(chip.textContent).toContain('3 doğru seriyle jeton kazan');
    cleanup();
    mount({ me: you('p1', { powers: powers({ sabotageTokens: 0, nextTokenAtStreak: null }) }) });
    expect(screen.getByTestId('prep-sabotage').textContent).toContain('Jetonun yok');
    cleanup();
    mount({ data: prep({ sabotageEnabled: false }) });
    chip = screen.getByTestId<HTMLButtonElement>('prep-sabotage');
    expect(chip.disabled).toBe(true);
    expect(chip.textContent).toContain('Bu turda kapalı');
    cleanup();
    mount({
      data: prep({
        sabotageEnabled: false,
        round: { ...ROUND, index: 9, total: 10, kind: 'FINAL', isFinal: true },
      }),
    });
    expect(screen.getByTestId('prep-sabotage').textContent).toContain('Final turunda sabotaj yok');
  });

  it('shows what is still in the bag: 50/50 and the shield', () => {
    mount({});
    expect(screen.getByTestId('prep-stock').textContent).toContain('50/50 ×1');
    expect(screen.getByTestId('prep-stock').textContent).toContain('Kalkan ×1');
  });

  it('never shows the question on the prep screen (the category is all the phone knows)', () => {
    mount({});
    expect(screen.getByTestId('ctl-prep').textContent).toContain('Spor');
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
