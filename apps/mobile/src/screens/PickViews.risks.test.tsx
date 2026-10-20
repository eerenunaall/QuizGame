import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import type { PhaseDataOf, RoomView } from '@quizparty/protocol';
import {
  answeringData,
  player,
  roomView,
  ROUND,
  stateWith,
  you,
} from '@quizparty/controller-client/fixtures';
import { renderLocalized } from '../testing/render';
import type { ControllerActions } from './actions';
import { ControllerScreen } from './ControllerScreen';

/** ADR-0023 on the native phone: the new risks and sabotages render, respect their rules and never crash. */
const prep = (patch: Partial<PhaseDataOf<'RISK_PICK'>> = {}): PhaseDataOf<'RISK_PICK'> => ({
  phase: 'RISK_PICK',
  round: { ...ROUND, index: 3, total: 10 },
  category: { id: 'geography', label: 'Coğrafya' },
  difficulty: 'MEDIUM',
  riskLadder: [
    { tier: 'SAFE', multiplier: 1, loss: 0, coverFee: 0 },
    { tier: 'RISK', multiplier: 2, loss: 100, coverFee: 50 },
    { tier: 'HIGH', multiplier: 3, loss: 200, coverFee: 100 },
  ],
  stakeMandatory: false,
  doubleDownEnabled: true,
  doubleDownExcludedStakes: ['HIGH', 'ALL_IN'],
  sabotageEnabled: true,
  risks: { cover: true, duel: { win: 80, bothRight: 40 }, pot: { ante: 30, minPlayers: 3 } },
  committedCount: 0,
  eligibleCount: 3,
  ...patch,
});
const powers = (patch: Record<string, unknown> = {}) => ({
  fiftyFifty: 1,
  doubleDown: 1,
  shield: 0,
  sabotageTokens: 1,
  nextTokenAtStreak: null,
  lockedJoker: null,
  cover: 1,
  duel: 2,
  pot: 2,
  ...patch,
});
const board = [
  { playerId: 'p0', score: 400, rank: 1, streak: 2 },
  { playerId: 'p1', score: 250, rank: 2, streak: 1 },
  { playerId: 'p2', score: 0, rank: 3, streak: 0 },
];
const gameOf = () => ({
  gameId: '22222222-2222-4222-8222-222222222222',
  totalRounds: 10,
  roundIndex: 3,
  scoreboard: board,
});
const players = () => [player(0), player(1), player(2, { nickname: 'Deniz' })];

function riskRoom(data = prep(), me: Partial<RoomView['you'] & object> = {}): RoomView {
  return roomView({
    phase: 'RISK_PICK',
    phaseData: data,
    phaseDeadlineAt: 5_000,
    players: players(),
    game: gameOf(),
    you: you('p1', { powers: powers(), ...me }),
  });
}
const commit = jest.fn<ControllerActions['commitRisk']>(() => Promise.resolve());
const respondDuel = jest.fn<NonNullable<ControllerActions['respondDuel']>>(() => Promise.resolve());
const commitSabotage = jest.fn<ControllerActions['commitSabotage']>(() => Promise.resolve());
async function show(r: RoomView) {
  const actions = {
    commitRisk: commit,
    commitSabotage,
    respondDuel,
    haptic: undefined,
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
const disabled = (id: string): boolean =>
  (screen.getByTestId(id).props as { accessibilityState: { disabled: boolean } }).accessibilityState
    .disabled;

describe('native Cover, Pot and Duel', () => {
  it('commits the stake with Cover, Pot and a Duel challenge in one message', async () => {
    commit.mockClear();
    await show(riskRoom());
    await fireEvent.press(screen.getByTestId('stake-RISK'));
    await fireEvent.press(screen.getByTestId('risk-cover'));
    await fireEvent.press(screen.getByTestId('risk-pot'));
    await fireEvent.press(screen.getByTestId('risk-duel'));
    await fireEvent.press(screen.getByTestId('duel-rival-Deniz'));
    await fireEvent.press(screen.getByTestId('prep-commit'));
    expect(commit).toHaveBeenCalledWith({
      stake: 'RISK',
      doubleDown: false,
      cover: true,
      pot: true,
      duel: { targetId: 'p2' },
    });
  });

  it('greys them with the reason: Cover on SAFE, a Duel with HIGH, Pot without the ante', async () => {
    await show(riskRoom());
    expect(disabled('risk-cover')).toBe(true);
    expect(screen.getByText('Risk veya üstü gerekli')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('stake-HIGH'));
    expect(disabled('risk-duel')).toBe(true);
    expect(screen.getAllByText('Soru başına tek büyük kumar').length).toBeGreaterThan(0);
  });

  it('shows nothing of them where they are switched off or the server is older', async () => {
    const old = prep();
    delete old.risks;
    await show(riskRoom(old));
    expect(screen.queryByTestId('risk-cover')).toBeNull();
    expect(screen.queryByTestId('risk-duel')).toBeNull();
  });

  it('answers a Duel invite, and closes the big stakes once it is accepted', async () => {
    respondDuel.mockClear();
    await show(riskRoom(prep(), { duelInvites: [{ challengerId: 'p0', answer: null }] }));
    expect(screen.getByTestId('duel-invite')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('duel-accept'));
    expect(respondDuel).toHaveBeenCalledWith('p0', true);
    await fireEvent.press(screen.getByTestId('duel-decline'));
    expect(respondDuel).toHaveBeenCalledWith('p0', false);
  });

  it('an accepted duel greys HIGH and Double Down', async () => {
    await show(riskRoom(prep(), { duelInvites: [{ challengerId: 'p0', answer: 'ACCEPTED' }] }));
    expect(disabled('stake-HIGH')).toBe(true);
    expect(disabled('double-down')).toBe(true);
  });

  it('Stake Cap closes the top rung and says why', async () => {
    await show(riskRoom(prep(), { powers: powers({ stakeCap: 'RISK' }) }));
    expect(disabled('stake-HIGH')).toBe(true);
    expect(screen.getByTestId('stake-cap-note')).toBeTruthy();
  });

  it('the committed screen lists the extras', async () => {
    await show(
      riskRoom(prep(), {
        commitment: {
          stake: 'RISK',
          doubleDown: false,
          sabotage: null,
          cover: true,
          pot: true,
          duel: { targetId: 'p2' },
        },
      }),
    );
    expect(screen.getByText('☂️ Örtü')).toBeTruthy();
    expect(screen.getByText('🏺 Havuz')).toBeTruthy();
    expect(screen.getByText('⚔️ Düello → Deniz')).toBeTruthy();
  });
});

describe('native new sabotages', () => {
  const menu = (
    patch: Partial<PhaseDataOf<'SABOTAGE_PICK'>> = {},
  ): PhaseDataOf<'SABOTAGE_PICK'> => ({
    phase: 'SABOTAGE_PICK',
    round: { ...ROUND, index: 3, total: 10 },
    category: { id: 'geography', label: 'Coğrafya' },
    difficulty: 'MEDIUM',
    committedCount: 0,
    eligibleCount: 3,
    offered: ['JAM', 'FOG', 'STAKE_CAP', 'CUT', 'BLIND_CLOCK'],
    cutRule: { permille: 200, maxPoints: 30 },
    ...patch,
  });
  const sabotageRoom = (data = menu()): RoomView =>
    roomView({
      phase: 'SABOTAGE_PICK',
      phaseData: data,
      phaseDeadlineAt: 5_000,
      players: players(),
      game: gameOf(),
      you: you('p1', { powers: powers(), sabotage: { ready: true, decided: false } }),
    });

  it('offers the server menu and sends a new kind', async () => {
    commitSabotage.mockClear();
    await show(sabotageRoom());
    await fireEvent.press(screen.getByTestId('sabotage-open'));
    await fireEvent.press(screen.getByTestId('sabotage-target-Player0'));
    expect(screen.queryByTestId('sabotage-effect-SHUFFLE')).toBeNull(); // not on the menu
    expect(disabled('sabotage-effect-CUT')).toBe(true); // Player0 leads
    expect(screen.getByText('Lider kesilemez')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sabotage-effect-BLIND_CLOCK'));
    await fireEvent.press(screen.getByTestId('sabotage-send'));
    expect(commitSabotage).toHaveBeenCalledWith({
      sabotage: { targetId: 'p0', effect: 'BLIND_CLOCK' },
    });
  });

  it('Cut states its numbers on a player it may aim at', async () => {
    const withPoints = sabotageRoom();
    withPoints.game!.scoreboard = [
      { playerId: 'p0', score: 400, rank: 1, streak: 2 },
      { playerId: 'p1', score: 250, rank: 2, streak: 1 },
      { playerId: 'p2', score: 100, rank: 3, streak: 0 },
    ];
    await show(withPoints);
    await fireEvent.press(screen.getByTestId('sabotage-open'));
    await fireEvent.press(screen.getByTestId('sabotage-target-Deniz'));
    expect(disabled('sabotage-effect-CUT')).toBe(false);
    expect(
      screen.getByText('Sonraki kazancının %20 kadarı sana geçer (en fazla 30).'),
    ).toBeTruthy();
  });

  it('Cut is grey on somebody with no points', async () => {
    await show(sabotageRoom());
    await fireEvent.press(screen.getByTestId('sabotage-open'));
    await fireEvent.press(screen.getByTestId('sabotage-target-Deniz'));
    expect(disabled('sabotage-effect-CUT')).toBe(true);
    expect(screen.getByText('Kesilecek puanı yok')).toBeTruthy();
  });
});

describe('native Blind Clock', () => {
  it('replaces the countdown with a note and still shows the answers', async () => {
    const data = answeringData({ answerDeadlineAt: 16_500 });
    const r = roomView({
      phase: 'ANSWERING',
      phaseData: data,
      players: players(),
      you: you('p1', {
        powers: powers(),
        effects: { jamMs: 0, order: null, fogOptionId: null, fogMs: 0, blindClock: true },
      }),
    });
    await show(r);
    expect(screen.getByTestId('blind-clock')).toBeTruthy();
    expect(screen.queryByTestId('answer-timer')).toBeNull();
    expect(screen.getByText(/Ankara/)).toBeTruthy();
  });
});
