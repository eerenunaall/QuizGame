import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { player, roomView, ROUND, you } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { SabotageScreen } from './SabotageScreen';
import type { SabotageChoice } from './powers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const data = (patch: Partial<PhaseDataOf<'SABOTAGE_PICK'>> = {}): PhaseDataOf<'SABOTAGE_PICK'> => ({
  phase: 'SABOTAGE_PICK',
  round: { ...ROUND, index: 3, total: 10 },
  category: { id: 'sports', label: 'Spor' },
  difficulty: 'HARD',
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

const ready = { sabotage: { ready: true, decided: false } };

function mount(options: {
  phaseData?: PhaseDataOf<'SABOTAGE_PICK'>;
  me?: ReturnType<typeof you>;
  onCommit?: (choice: SabotageChoice) => Promise<void>;
  deadlineAt?: number;
}) {
  const phaseData = options.phaseData ?? data();
  const room: RoomView = roomView({
    phase: 'SABOTAGE_PICK',
    phaseData,
    phaseEnteredAt: 1000,
    phaseDeadlineAt: options.deadlineAt ?? 7000,
    players: [
      player(0, { nickname: 'Ece' }),
      player(1, { nickname: 'Ahmet' }),
      player(2, { nickname: 'Merve' }),
    ],
    you: options.me ?? you('p1', { powers: powers(), ...ready }),
  });
  const onCommit = options.onCommit ?? vi.fn(() => Promise.resolve());
  render(
    <I18nProvider locale="tr">
      <SabotageScreen room={room} data={phaseData} now={() => 2000} onCommit={onCommit} />
    </I18nProvider>,
  );
  return { onCommit };
}

describe('SabotageScreen', () => {
  it('has its own loud title, rule and clock, and offers the chip and a way to pass', () => {
    mount({});
    expect(screen.getByTestId('pick-title').textContent).toBe('SABOTAJ ZAMANI');
    expect(screen.getByTestId('pick-rule').textContent).toBeTruthy();
    expect(screen.getByTestId('prep-sabotage').textContent).toContain('1 jeton');
    expect(screen.getByTestId('sabotage-skip')).toBeTruthy();
    expect(screen.queryByTestId('stake-SAFE')).toBeNull(); // stakes live on the other screen
  });

  it('sabotage: chip, a face, a card, one big button; the commit goes out after a 2 s undo window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onCommit } = mount({ deadlineAt: 30_000 });
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    expect(screen.getByTestId('sabotage-sheet').getAttribute('data-step')).toBe('who');
    expect(screen.queryByTestId('sabotage-target-Ahmet')).toBeNull(); // not myself
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    for (const kind of ['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX'])
      expect(screen.getByTestId(`sabotage-effect-${kind}`)).toBeTruthy();
    const confirm = screen.getByTestId<HTMLButtonElement>('sabotage-confirm');
    expect(confirm.disabled).toBe(true);
    expect(screen.getByTestId('sabotage-why').textContent).toBe('Önce bir sabotaj seç');
    fireEvent.click(screen.getByTestId('sabotage-effect-FOG'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

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
    expect(onCommit).toHaveBeenCalledWith({ sabotage: { targetId: 'p2', effect: 'FOG' } });
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

  it('with almost no time left the sabotage goes out at once (an undo window would eat the commit)', async () => {
    const { onCommit } = mount({ deadlineAt: 3000 }); // now() is 2000: one second left
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Ece'));
    fireEvent.click(screen.getByTestId('sabotage-effect-POINT_TAX'));
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({ sabotage: { targetId: 'p0', effect: 'POINT_TAX' } });
  });

  it('asks which joker to lock for a lockout, and stays grey until one is picked', async () => {
    const { onCommit } = mount({ deadlineAt: 3000 });
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Ece'));
    fireEvent.click(screen.getByTestId('sabotage-effect-LOCKOUT'));
    expect(screen.getByTestId<HTMLButtonElement>('sabotage-confirm').disabled).toBe(true);
    expect(screen.getByTestId('sabotage-why').textContent).toBe('Kilitlenecek jokeri seç');
    fireEvent.click(screen.getByTestId('sabotage-joker-FIFTY_FIFTY'));
    fireEvent.click(screen.getByTestId('sabotage-confirm'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit).toHaveBeenCalledWith({
      sabotage: { targetId: 'p0', effect: 'LOCKOUT', joker: 'FIFTY_FIFTY' },
    });
  });

  it('"no sabotage" confirms with null so the table does not wait', async () => {
    const { onCommit } = mount({});
    fireEvent.click(screen.getByTestId('sabotage-skip'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ sabotage: null }));
  });

  it('a refused sabotage is dropped and explained, and the player can try again or pass', async () => {
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
    expect(screen.getByTestId('prep-sabotage').textContent).not.toContain('Merve');
    const skip = screen.getByTestId<HTMLButtonElement>('sabotage-skip');
    await waitFor(() => expect(skip.disabled).toBe(false));
    fireEvent.click(skip);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(onCommit).toHaveBeenLastCalledWith({ sabotage: null });
  });

  it('a back step lets the player change the face', () => {
    mount({});
    fireEvent.click(screen.getByTestId('prep-sabotage'));
    fireEvent.click(screen.getByTestId('sabotage-target-Merve'));
    expect(screen.getByTestId('sabotage-target-chosen').textContent).toContain('Merve');
    fireEvent.click(screen.getByTestId('sabotage-back'));
    expect(screen.getByTestId('sabotage-sheet').getAttribute('data-step')).toBe('who');
    fireEvent.click(screen.getByTestId('sabotage-close'));
    expect(screen.queryByTestId('sabotage-sheet')).toBeNull();
  });

  it('a player who cannot sabotage gets a calm waiting screen with the count, and no buttons', () => {
    mount({ me: you('p1', { powers: powers({ sabotageTokens: 0 }) }) });
    expect(screen.getByTestId('ctl-sabotage-wait').textContent).toContain('Rakipler karar veriyor');
    expect(screen.getByTestId('ctl-sabotage-wait').textContent).toContain(
      '3 doğru seriyle jeton kazan',
    );
    expect(screen.getByTestId('pick-waiting').textContent).toContain('1/3 oyuncu hazır');
    expect(screen.queryByTestId('prep-sabotage')).toBeNull();
    expect(screen.queryByTestId('sabotage-skip')).toBeNull();
    cleanup();
    // Tokens, but the server says a cooldown (or nobody to hit) rules this round out.
    mount({
      me: you('p1', { powers: powers(), sabotage: { ready: false, decided: false } }),
    });
    expect(screen.getByTestId('ctl-sabotage-wait').textContent).toContain(
      'Bu turda sabotaj yapamazsın.',
    );
  });

  it('after confirming shows what was sent and the count, and cannot be changed', () => {
    mount({
      me: you('p1', {
        powers: powers(),
        sabotage: { ready: false, decided: true },
        commitment: {
          stake: 'SAFE',
          doubleDown: false,
          sabotage: { targetId: 'p2', effect: 'POINT_TAX' },
        },
      }),
    });
    const done = screen.getByTestId('ctl-sabotage-committed').textContent ?? '';
    expect(done).toContain('Seçimin kilitlendi');
    expect(done).toContain('Vergi → Merve');
    expect(done).toContain('1/3 oyuncu hazır');
    expect(screen.queryByTestId('prep-sabotage')).toBeNull();
  });

  it('shows "you passed" when no sabotage was sent', () => {
    mount({ me: you('p1', { powers: powers(), sabotage: { ready: false, decided: true } }) });
    expect(screen.getByTestId('ctl-sabotage-committed').textContent).toContain('Sabotaj yapmadın');
  });

  it('never shows the question text', () => {
    mount({});
    expect(screen.getByTestId('ctl-sabotage').textContent).toContain('Spor');
    expect(screen.queryByTestId('peek-text')).toBeNull();
  });
});
