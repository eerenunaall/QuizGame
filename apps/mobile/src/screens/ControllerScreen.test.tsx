import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import type { PhaseData, RoomView } from '@quizparty/protocol';
import {
  answeringData,
  player,
  roomView,
  ROUND,
  stateWith,
  you,
} from '@quizparty/controller-client/fixtures';
import type { ClientState } from '@quizparty/controller-client';
import { renderLocalized } from '../testing/render';
import type { ControllerActions } from './actions';
import { ControllerScreen } from './ControllerScreen';

function actions(over: Partial<ControllerActions> = {}): ControllerActions {
  return {
    ready: jest.fn(),
    start: jest.fn(),
    settings: jest.fn(),
    answer: jest.fn(),
    rematch: jest.fn(),
    backToLobby: jest.fn(),
    leave: jest.fn(),
    commit: jest.fn(() => Promise.resolve()),
    fifty: jest.fn(),
    submitStatement: jest.fn(() => Promise.resolve()),
    ...over,
  };
}

const NOW = 2_000;
async function show(
  room: RoomView,
  over: Partial<ClientState> = {},
  a: ControllerActions = actions(),
  locale: 'tr' | 'en' = 'tr',
) {
  await renderLocalized(
    <ControllerScreen
      state={stateWith(room, over)}
      now={() => NOW}
      busy={false}
      error={null}
      actions={a}
    />,
    locale,
  );
  return a;
}
const inPhase = (phaseData: PhaseData, patch: Partial<RoomView> = {}): RoomView =>
  roomView({ phase: phaseData.phase, phaseData, ...patch });

describe('state to UI mapping', () => {
  it.each([
    [{ phase: 'COUNTDOWN' }, 'ctl-countdown'],
    [{ phase: 'MICRO_INTERMISSION', next: null }, 'ctl-next'],
    [{ phase: 'POWER_RESOLUTION', round: ROUND, items: [] }, 'ctl-power'],
    [{ phase: 'FINAL', round: ROUND }, 'ctl-final'],
    [{ phase: 'ROOM_CLOSED', reason: 'ENDED' }, 'ctl-closed'],
  ] as [PhaseData, string][])('%j shows %s', async (data, testId) => {
    await show(inPhase(data));
    expect(screen.getByTestId(testId)).toBeTruthy();
  });

  it('lobby: the leader can start; the others wait for the leader', async () => {
    const a = actions();
    await show(roomView({ you: you('p0', { isLeader: true }) }), {}, a);
    await fireEvent.press(screen.getByTestId('ctl-start'));
    expect(a.start).toHaveBeenCalledTimes(1);
  });

  it('lobby: a non-leader sees no start button and can toggle ready', async () => {
    const a = actions();
    await show(roomView(), {}, a);
    expect(screen.queryByTestId('ctl-start')).toBeNull();
    expect(screen.getByText('Lider oyunu başlatacak…')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ctl-ready'));
    expect(a.ready).toHaveBeenCalledWith(true);
  });

  it('lobby: starting needs two players', async () => {
    await show(roomView({ players: [player(0)], you: you('p0', { isLeader: true }) }));
    expect(screen.getByTestId('ctl-start').props.accessibilityState.disabled).toBe(true);
  });

  it('lobby: leader changes the round count through the settings intent', async () => {
    const a = actions();
    await show(roomView({ you: you('p0', { isLeader: true }) }), {}, a);
    await fireEvent.press(screen.getByLabelText('10'));
    expect(a.settings).toHaveBeenCalledWith({ rounds: 10 });
  });

  it('lobby is localised: English copy', async () => {
    await show(roomView(), {}, actions(), 'en');
    expect(screen.getByText('The leader will start the game…')).toBeTruthy();
  });

  it('QUESTION shows the text only (no options before the window opens)', async () => {
    await show(
      inPhase({
        phase: 'QUESTION',
        round: ROUND,
        questionId: 'q1',
        text: 'Başkent?',
        category: { id: 'geography', label: 'Coğrafya' },
        difficulty: 'EASY',
      }),
    );
    expect(screen.getByText('Başkent?')).toBeTruthy();
    expect(screen.queryByTestId('ctl-answering')).toBeNull();
  });

  it('LOCKED: tells a player who answered, and a late one, apart', async () => {
    const data: PhaseData = {
      phase: 'LOCKED',
      round: ROUND,
      questionId: 'q1',
      answeredPlayerIds: [],
    };
    await show(
      inPhase(data, {
        you: you('p1', { answer: { questionId: 'q1', optionId: 'optionAAAA', lockedAt: 1 } }),
      }),
    );
    expect(screen.getByText('Cevabın kilitlendi')).toBeTruthy();
  });

  it('LOCKED without an answer says too late', async () => {
    await show(inPhase({ phase: 'LOCKED', round: ROUND, questionId: 'q1', answeredPlayerIds: [] }));
    expect(screen.getByText('Çok geç kaldın')).toBeTruthy();
  });
});

describe('answering, 50/50 and sabotage effects', () => {
  const powers = {
    fiftyFifty: 1,
    doubleDown: 1,
    shield: 0,
    sabotageTokens: 0,
    nextTokenAtStreak: 3,
    lockedJoker: null,
  };
  const answering = (patch: Partial<RoomView> = {}) => inPhase(answeringData(), patch);

  it('shows every option with letter and shape and sends the tapped option id', async () => {
    const a = actions();
    await show(answering(), {}, a);
    expect(screen.getByText('A ▲')).toBeTruthy();
    expect(screen.getByText('B ◆')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('option-optionBBBB'));
    expect(a.answer).toHaveBeenCalledWith('optionBBBB');
  });

  it('options are labelled for screen readers', async () => {
    await show(answering());
    expect(screen.getByLabelText('A seçeneği: Ankara')).toBeTruthy();
  });

  it('after tapping, the pending answer disables the others', async () => {
    await show(answering(), { pendingAnswer: { questionId: 'q1', optionId: 'optionAAAA' } });
    expect(screen.getByTestId('option-optionBBBB').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Gönderiliyor…')).toBeTruthy();
  });

  it('a confirmed answer shows the locked screen', async () => {
    await show(
      answering({
        you: you('p1', { answer: { questionId: 'q1', optionId: 'optionAAAA', lockedAt: 1 } }),
      }),
    );
    expect(screen.getByTestId('ctl-confirmed')).toBeTruthy();
  });

  it('the 50/50 joker is offered while one is left and calls the intent', async () => {
    const a = actions();
    await show(answering({ you: you('p1', { powers }) }), {}, a);
    await fireEvent.press(screen.getByTestId('use-fifty'));
    expect(a.fifty).toHaveBeenCalledTimes(1);
  });

  it('no 50/50 button when none are left; a lockout explains why', async () => {
    await show(answering({ you: you('p1', { powers: { ...powers, fiftyFifty: 0 } }) }));
    expect(screen.queryByTestId('use-fifty')).toBeNull();
  });

  it('a locked-out 50/50 says so', async () => {
    await show(
      answering({ you: you('p1', { powers: { ...powers, lockedJoker: 'FIFTY_FIFTY' } }) }),
    );
    expect(screen.getByText('50/50 bu tur kilitli')).toBeTruthy();
  });

  it('after 50/50 only the kept options can be tapped', async () => {
    await show(answering({ you: you('p1', { powers, fiftyFifty: { keep: ['optionAAAA'] } }) }));
    expect(screen.getByTestId('fifty-used')).toBeTruthy();
    expect(screen.getByTestId('option-optionBBBB').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('option-optionAAAA').props.accessibilityState.disabled).toBe(false);
  });

  it('SHUFFLE reorders the options on this phone only', async () => {
    await show(
      answering({
        you: you('p1', {
          effects: { jamMs: 0, order: ['optionBBBB', 'optionAAAA'], fogOptionId: null, fogMs: 0 },
        }),
      }),
    );
    expect(screen.getByLabelText('A seçeneği: İstanbul')).toBeTruthy();
  });

  it('FOG hides one option text while the veil is up', async () => {
    await show(
      answering({
        you: you('p1', {
          effects: { jamMs: 0, order: null, fogOptionId: 'optionAAAA', fogMs: 5_000 },
        }),
      }),
    );
    expect(screen.getByLabelText('A seçeneği: …')).toBeTruthy();
  });

  it('a rejected answer shows the mapped error, never server text', async () => {
    await show(answering(), { answerRejection: { code: 'ANSWER_LATE', at: 1 } });
    expect(screen.getByText('Çok geç kaldın.')).toBeTruthy();
  });

  it('Who Said It: the author sits the round out', async () => {
    await show(answering({ you: you('p1', { authorOfRound: true }) }));
    expect(screen.getByTestId('ctl-sitout')).toBeTruthy();
    expect(screen.queryByTestId('ctl-answering')).toBeNull();
  });
});

describe('reveal, score and results', () => {
  const reveal = (outcome: 'CORRECT' | 'INCORRECT' | 'NO_ANSWER') =>
    inPhase({
      phase: 'REVEAL',
      round: ROUND,
      questionId: 'q1',
      text: 'Başkent?',
      options: [
        { optionId: 'optionAAAA', text: 'Ankara' },
        { optionId: 'optionBBBB', text: 'İstanbul' },
      ],
      correctOptionId: 'optionAAAA',
      explanation: null,
      distribution: [],
      results: [
        { playerId: 'p1', outcome, optionId: outcome === 'NO_ANSWER' ? null : 'optionAAAA' },
      ],
    });

  it.each([
    ['CORRECT', 'Doğru!'],
    ['INCORRECT', 'Yanlış'],
    ['NO_ANSWER', 'Cevap vermedin'],
  ] as const)('reveal for %s', async (outcome, text) => {
    await show(reveal(outcome));
    expect(screen.getByTestId('ctl-outcome').props.children).toBe(text);
    expect(screen.getByText('Ankara')).toBeTruthy();
  });

  it('haptics fire once on a correct reveal, and only when provided', async () => {
    const haptic = jest.fn();
    await show(reveal('CORRECT'), {}, actions({ haptic }));
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('correct');
  });

  it("score screen shows this player's delta and rank", async () => {
    await show(
      inPhase({
        phase: 'SCORE_UPDATE',
        round: ROUND,
        deltas: [
          { playerId: 'p1', delta: 750, total: 750, rank: 1, previousRank: 2, components: [] },
        ],
        scoreboard: [
          { playerId: 'p1', score: 750, rank: 1, streak: 1 },
          { playerId: 'p0', score: 500, rank: 2, streak: 0 },
        ],
      }),
    );
    expect(screen.getByTestId('ctl-delta').props.children).toBe('+750');
    expect(screen.getByText('1. sıradasın')).toBeTruthy();
  });

  const results: PhaseData = {
    phase: 'RESULTS',
    ranking: [
      { playerId: 'p1', score: 2200, rank: 1, correctCount: 4, bestStreak: 3 },
      { playerId: 'p0', score: 1000, rank: 2, correctCount: 2, bestStreak: 1 },
    ],
    awards: [],
  };

  it('results show the final rank and points; non-leaders cannot rematch', async () => {
    await show(inPhase(results));
    expect(screen.getByTestId('ctl-final-rank').props.children).toBe(1);
    expect(screen.getByText('2200 puan · 4 doğru')).toBeTruthy();
    expect(screen.queryByTestId('ctl-rematch')).toBeNull();
  });

  it('results: the leader gets rematch and back-to-lobby', async () => {
    const a = actions();
    await show(inPhase(results, { you: you('p1', { isLeader: true }) }), {}, a);
    await fireEvent.press(screen.getByTestId('ctl-rematch'));
    await fireEvent.press(screen.getByTestId('ctl-lobby-back'));
    expect(a.rematch).toHaveBeenCalled();
    expect(a.backToLobby).toHaveBeenCalled();
  });
});
