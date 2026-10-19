import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { player, roomView, ROUND, stateWith, you } from '@quizparty/controller-client/fixtures';
import { renderLocalized } from '../testing/render';
import type { ControllerActions } from './actions';
import { ControllerScreen } from './ControllerScreen';

const prep = (patch: Partial<PhaseDataOf<'QUESTION_PREP'>> = {}): PhaseDataOf<'QUESTION_PREP'> => ({
  phase: 'QUESTION_PREP',
  round: { ...ROUND, kind: 'RISK' },
  category: { id: 'geography', label: 'Coğrafya' },
  difficulty: 'MEDIUM',
  riskLadder: [
    { tier: 'SAFE', multiplier: 1, loss: 0 },
    { tier: 'RISK', multiplier: 2, loss: 200 },
    { tier: 'HIGH', multiplier: 3, loss: 400 },
    { tier: 'ALL_IN', multiplier: 5, loss: 800 },
  ],
  stakeMandatory: false,
  doubleDownEnabled: true,
  sabotageEnabled: true,
  committedCount: 0,
  eligibleCount: 3,
  ...patch,
});
const powers = {
  fiftyFifty: 1,
  doubleDown: 1,
  shield: 0,
  sabotageTokens: 1,
  nextTokenAtStreak: null,
  lockedJoker: null,
};

function room(data = prep(), me: Partial<RoomView['you'] & object> = {}): RoomView {
  return roomView({
    phase: 'QUESTION_PREP',
    phaseData: data,
    phaseDeadlineAt: 5_000,
    players: [player(0), player(1), player(2, { nickname: 'Deniz' })],
    you: you('p1', { powers, ...me }),
  });
}
const commit = jest.fn<ControllerActions['commit']>(() => Promise.resolve());
async function show(r: RoomView, over: Partial<ControllerActions> = {}) {
  const actions = { commit, haptic: undefined, ...over } as unknown as ControllerActions;
  await renderLocalized(
    <ControllerScreen
      state={stateWith(r)}
      now={() => 2_000}
      busy={false}
      error={null}
      actions={actions}
    />,
  );
}

describe('Risk / stake screen', () => {
  it('defaults to the lowest rung and commits it as one final message', async () => {
    commit.mockClear();
    await show(room());
    await fireEvent.press(screen.getByTestId('prep-commit'));
    expect(commit).toHaveBeenCalledWith({ stake: 'SAFE', doubleDown: false, sabotage: null });
  });

  it('commits the chosen stake and Double Down together', async () => {
    commit.mockClear();
    await show(room());
    await fireEvent.press(screen.getByTestId('stake-HIGH'));
    await fireEvent.press(screen.getByTestId('double-down'));
    await fireEvent.press(screen.getByTestId('prep-commit'));
    expect(commit).toHaveBeenCalledWith({ stake: 'HIGH', doubleDown: true, sabotage: null });
  });

  it('the last question has no SAFE rung and says the stake is mandatory', async () => {
    commit.mockClear();
    await show(
      room(
        prep({
          stakeMandatory: true,
          riskLadder: [
            { tier: 'RISK', multiplier: 2, loss: 200 },
            { tier: 'HIGH', multiplier: 3, loss: 400 },
          ],
        }),
      ),
    );
    expect(screen.getByText('Son soru! Bahis zorunlu.')).toBeTruthy();
    expect(screen.queryByTestId('stake-SAFE')).toBeNull();
    await fireEvent.press(screen.getByTestId('prep-commit'));
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ stake: 'RISK' }));
  });

  it('Double Down is disabled when none are left or when a lockout blocks it', async () => {
    await show(room(prep(), { powers: { ...powers, doubleDown: 0 } }));
    expect(screen.getByTestId('double-down').props.accessibilityState.disabled).toBe(true);
  });

  it("shows the server's refusal as mapped copy and lets the player retry", async () => {
    const failing = jest.fn<ControllerActions['commit']>(() =>
      Promise.reject(Object.assign(new Error('x'), { code: 'STAKE_INVALID' })),
    );
    await show(room(), { commit: failing });
    await fireEvent.press(screen.getByTestId('prep-commit'));
    await waitFor(() => expect(screen.getByTestId('prep-error')).toBeTruthy());
    expect(screen.getByText('Bu bahis seçilemez.')).toBeTruthy();
  });

  it('after committing the screen summarises the choice and who else is pending', async () => {
    await show(
      room(prep({ committedCount: 1 }), {
        commitment: {
          stake: 'RISK',
          doubleDown: true,
          sabotage: { targetId: 'p2', effect: 'FOG' },
        },
      }),
    );
    expect(screen.getByTestId('ctl-prep-committed')).toBeTruthy();
    expect(screen.getByText('Çifte Hak')).toBeTruthy();
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.queryByTestId('prep-commit')).toBeNull();
  });
});

describe('Sabotage picker', () => {
  it('walks who → what and commits the sabotage with the prep choice', async () => {
    commit.mockClear();
    await show(room());
    await fireEvent.press(screen.getByTestId('sabotage-open'));
    expect(screen.getByTestId('sabotage-picker')).toBeTruthy();
    expect(screen.queryByTestId('sabotage-target-Player1')).toBeNull(); // not yourself
    await fireEvent.press(screen.getByTestId('sabotage-target-Deniz'));
    await fireEvent.press(screen.getByTestId('sabotage-effect-FOG'));
    await fireEvent.press(screen.getByTestId('prep-commit'));
    expect(commit).toHaveBeenCalledWith({
      stake: 'SAFE',
      doubleDown: false,
      sabotage: { targetId: 'p2', effect: 'FOG' },
    });
  });

  it('LOCKOUT asks which joker to lock', async () => {
    commit.mockClear();
    await show(room());
    await fireEvent.press(screen.getByTestId('sabotage-open'));
    await fireEvent.press(screen.getByTestId('sabotage-target-Deniz'));
    await fireEvent.press(screen.getByTestId('sabotage-effect-LOCKOUT'));
    await fireEvent.press(screen.getByTestId('sabotage-joker-FIFTY_FIFTY'));
    await fireEvent.press(screen.getByTestId('prep-commit'));
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        sabotage: { targetId: 'p2', effect: 'LOCKOUT', joker: 'FIFTY_FIFTY' },
      }),
    );
  });

  it('sabotage is disabled without a token', async () => {
    await show(room(prep(), { powers: { ...powers, sabotageTokens: 0, nextTokenAtStreak: 3 } }));
    expect(screen.getByTestId('sabotage-open').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('3 doğru seriyle jeton kazan')).toBeTruthy();
  });
});
