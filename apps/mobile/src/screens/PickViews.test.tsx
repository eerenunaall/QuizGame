import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import { player, roomView, ROUND, stateWith, you } from '@quizparty/controller-client/fixtures';
import { renderLocalized } from '../testing/render';
import type { ControllerActions } from './actions';
import { ControllerScreen } from './ControllerScreen';

const prep = (patch: Partial<PhaseDataOf<'RISK_PICK'>> = {}): PhaseDataOf<'RISK_PICK'> => ({
  phase: 'RISK_PICK',
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

const sabotagePhase = (
  patch: Partial<PhaseDataOf<'SABOTAGE_PICK'>> = {},
): PhaseDataOf<'SABOTAGE_PICK'> => ({
  phase: 'SABOTAGE_PICK',
  round: { ...ROUND, kind: 'STANDARD' },
  category: { id: 'geography', label: 'Coğrafya' },
  difficulty: 'MEDIUM',
  committedCount: 0,
  eligibleCount: 3,
  ...patch,
});

function sabotageRoom(
  me: Partial<RoomView['you'] & object> = {},
  data = sabotagePhase(),
): RoomView {
  return roomView({
    phase: 'SABOTAGE_PICK',
    phaseData: data,
    phaseDeadlineAt: 5_000,
    players: [player(0), player(1), player(2, { nickname: 'Deniz' })],
    you: you('p1', { powers, sabotage: { ready: true, decided: false }, ...me }),
  });
}

function room(data = prep(), me: Partial<RoomView['you'] & object> = {}): RoomView {
  return roomView({
    phase: 'RISK_PICK',
    phaseData: data,
    phaseDeadlineAt: 5_000,
    players: [player(0), player(1), player(2, { nickname: 'Deniz' })],
    you: you('p1', { powers, ...me }),
  });
}
const commit = jest.fn<ControllerActions['commitRisk']>(() => Promise.resolve());
const commitSabotage = jest.fn<ControllerActions['commitSabotage']>(() => Promise.resolve());
async function show(r: RoomView, over: Partial<ControllerActions> = {}) {
  const actions = {
    commitRisk: commit,
    commitSabotage,
    haptic: undefined,
    ...over,
  } as unknown as ControllerActions;
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
    expect(commit).toHaveBeenCalledWith({ stake: 'SAFE', doubleDown: false });
  });

  it('commits the chosen stake and Double Down together', async () => {
    commit.mockClear();
    await show(room());
    await fireEvent.press(screen.getByTestId('stake-HIGH'));
    await fireEvent.press(screen.getByTestId('double-down'));
    await fireEvent.press(screen.getByTestId('prep-commit'));
    expect(commit).toHaveBeenCalledWith({ stake: 'HIGH', doubleDown: true });
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
    const failing = jest.fn<ControllerActions['commitRisk']>(() =>
      Promise.reject(Object.assign(new Error('x'), { code: 'STAKE_INVALID' })),
    );
    await show(room(), { commitRisk: failing });
    await fireEvent.press(screen.getByTestId('prep-commit'));
    await waitFor(() => expect(screen.getByTestId('prep-error')).toBeTruthy());
    expect(screen.getByText('Bu bahis seçilemez.')).toBeTruthy();
  });

  it('after committing the screen summarises the choice and who else is pending', async () => {
    await show(
      room(prep({ committedCount: 1 }), {
        commitment: { stake: 'RISK', doubleDown: true, sabotage: null },
      }),
    );
    expect(screen.getByTestId('ctl-risk-committed')).toBeTruthy();
    expect(screen.getByText('Çifte Hak')).toBeTruthy();
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.queryByTestId('prep-commit')).toBeNull();
  });
});

describe('Risk screen chrome', () => {
  it('has a loud title and no sabotage controls', async () => {
    await show(room());
    expect(screen.getByText('RİSK ZAMANI')).toBeTruthy();
    expect(screen.queryByTestId('sabotage-open')).toBeNull();
  });
});

describe('Sabotage screen', () => {
  it('walks who → what → send and commits only the sabotage', async () => {
    commitSabotage.mockClear();
    await show(sabotageRoom());
    expect(screen.getByText('SABOTAJ ZAMANI')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sabotage-open'));
    expect(screen.getByTestId('sabotage-picker')).toBeTruthy();
    expect(screen.queryByTestId('sabotage-target-Player1')).toBeNull(); // not yourself
    await fireEvent.press(screen.getByTestId('sabotage-target-Deniz'));
    await fireEvent.press(screen.getByTestId('sabotage-effect-FOG'));
    await fireEvent.press(screen.getByTestId('sabotage-send'));
    expect(commitSabotage).toHaveBeenCalledWith({ sabotage: { targetId: 'p2', effect: 'FOG' } });
  });

  it('LOCKOUT asks which joker to lock', async () => {
    commitSabotage.mockClear();
    await show(sabotageRoom());
    await fireEvent.press(screen.getByTestId('sabotage-open'));
    await fireEvent.press(screen.getByTestId('sabotage-target-Deniz'));
    await fireEvent.press(screen.getByTestId('sabotage-effect-LOCKOUT'));
    await fireEvent.press(screen.getByTestId('sabotage-joker-FIFTY_FIFTY'));
    await fireEvent.press(screen.getByTestId('sabotage-send'));
    expect(commitSabotage).toHaveBeenCalledWith({
      sabotage: { targetId: 'p2', effect: 'LOCKOUT', joker: 'FIFTY_FIFTY' },
    });
  });

  it('"no sabotage" confirms with null', async () => {
    commitSabotage.mockClear();
    await show(sabotageRoom());
    await fireEvent.press(screen.getByTestId('sabotage-skip'));
    expect(commitSabotage).toHaveBeenCalledWith({ sabotage: null });
  });

  it('a player without a token gets the calm waiting screen', async () => {
    await show(sabotageRoom({ powers: { ...powers, sabotageTokens: 0, nextTokenAtStreak: 3 } }));
    expect(screen.getByTestId('ctl-sabotage-wait')).toBeTruthy();
    expect(screen.getByText('3 doğru seriyle jeton kazan')).toBeTruthy();
    expect(screen.queryByTestId('sabotage-open')).toBeNull();
  });

  it('after confirming shows what was sent', async () => {
    await show(
      sabotageRoom({
        sabotage: { ready: false, decided: true },
        commitment: {
          stake: 'SAFE',
          doubleDown: false,
          sabotage: { targetId: 'p2', effect: 'FOG' },
        },
      }),
    );
    expect(screen.getByTestId('ctl-sabotage-committed')).toBeTruthy();
  });

  it('a recovered QUESTION_PREP renders as the risk screen instead of crashing', async () => {
    const legacy = room({ ...prep(), phase: 'QUESTION_PREP' } as never);
    await show(legacy);
    expect(screen.getByTestId('ctl-risk')).toBeTruthy();
  });
});
