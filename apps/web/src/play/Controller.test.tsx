import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseData, RoomView } from '@quizparty/protocol';
import {
  answeringData,
  player,
  roomView,
  ROUND,
  stateWith,
  you,
} from '@quizparty/controller-client/fixtures';
import type { ClientState, KeyValueStorage } from '@quizparty/controller-client';
import { I18nProvider } from '../lib/i18n';
import { createStorage, loadPreferences } from '../lib/storage';
import { Controller, type ControllerActions } from './Controller';
import { phoneShowsQuestionDefault, resolveShowQuestion } from './questionPeek';

afterEach(cleanup);

const QUESTION_TEXT = 'Türkiye’nin başkenti neresidir?';

const actions = (): ControllerActions => ({
  ready: vi.fn(),
  start: vi.fn(),
  settings: vi.fn(),
  answer: vi.fn(),
  rematch: vi.fn(),
  backToLobby: vi.fn(),
  leave: vi.fn(),
  kick: vi.fn(),
  makeLeader: vi.fn(),
  commit: vi.fn(() => Promise.resolve()),
  fifty: vi.fn(),
  setReduced: vi.fn(),
  submitStatement: vi.fn(() => Promise.resolve()),
});

const OPTIONS = [
  { optionId: 'optionAAAA', text: 'Ankara' },
  { optionId: 'optionBBBB', text: 'İstanbul' },
  { optionId: 'optionCCCC', text: 'İzmir' },
  { optionId: 'optionDDDD', text: 'Bursa' },
];

interface Setup {
  phaseData?: PhaseData;
  me?: ReturnType<typeof you>;
  state?: Partial<ClientState>;
  storage?: KeyValueStorage;
  locale?: 'tr' | 'en';
  act?: ControllerActions;
}

function mount(setup: Setup = {}) {
  const phaseData =
    setup.phaseData ??
    answeringData({ text: QUESTION_TEXT, options: OPTIONS, answerDeadlineAt: 16_500 });
  const room: RoomView = roomView({
    phase: phaseData.phase,
    phaseData,
    players: [player(0, { nickname: 'Ece' }), player(1, { nickname: 'Ahmet' })],
    you: setup.me ?? you('p1', { powers: powersOf() }),
  });
  const act = setup.act ?? actions();
  const storage = setup.storage ?? createStorage(null);
  const view = (
    <I18nProvider locale={setup.locale ?? 'tr'}>
      <Controller
        room={room}
        state={stateWith(room, setup.state)}
        now={() => 2000}
        catalog={null}
        busy={false}
        error={null}
        actions={act}
        storage={storage}
      />
    </I18nProvider>
  );
  const result = render(view);
  return { act, storage, view, ...result };
}

function powersOf(patch: Record<string, unknown> = {}) {
  return {
    fiftyFifty: 1,
    doubleDown: 1,
    shield: 1,
    sabotageTokens: 0,
    nextTokenAtStreak: 3,
    lockedJoker: null,
    ...patch,
  };
}

describe('answering: the TV is the stage, the phone is the controller', () => {
  it('does not show the question text; it shows the answers and a "look at the TV" hint', () => {
    mount();
    expect(screen.queryByText(QUESTION_TEXT)).toBeNull();
    expect(screen.queryByTestId('peek-text')).toBeNull();
    expect(screen.getByTestId('ctl-tv-hint').textContent).toBe("Soruya TV'den bak");
    expect(screen.getByTestId('ctl-tv-hint').querySelector('svg[data-icon="tv"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'A: Ankara' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'D: Bursa' })).toBeTruthy();
  });

  it('says the same in English', () => {
    mount({ locale: 'en' });
    expect(screen.getByTestId('ctl-tv-hint').textContent).toBe('Look at the TV for the question');
    expect(screen.getByTestId('peek-toggle').textContent).toBe('Show question');
  });

  it('every answer carries a colour, a letter and a shape', () => {
    mount();
    const cards = [...document.querySelectorAll<HTMLElement>('button[data-answer-index]')];
    expect(cards).toHaveLength(4);
    const shapes = cards.map((card) =>
      card.querySelector('svg[data-shape]')?.getAttribute('data-shape'),
    );
    expect(shapes).toEqual(['triangle', 'diamond', 'circle', 'square']);
    expect(cards.map((card) => card.getAttribute('aria-label')?.charAt(0))).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    // four different colour classes (the CSS module maps them to the four answer gradients)
    expect(
      new Set(cards.map((card) => card.className.split(/\s+/u).find((c) => /_[abcd]_/u.test(c))))
        .size,
    ).toBe(4);
  });

  it('a small switch reveals the question in place, and the choice is remembered on this device', () => {
    const storage = createStorage(null);
    const first = mount({ storage });
    const toggle = screen.getByTestId('peek-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toBe('Soruyu göster');
    fireEvent.click(toggle);
    expect(screen.getByTestId('peek-text').textContent).toBe(QUESTION_TEXT);
    expect(screen.getByTestId('peek-toggle').textContent).toBe('Soruyu gizle');
    expect(loadPreferences(storage).phoneShowsQuestion).toBe(true);
    first.unmount();

    // the next question (a fresh mount) on the same device starts revealed
    mount({ storage });
    expect(screen.getByTestId('peek-text').textContent).toBe(QUESTION_TEXT);
    fireEvent.click(screen.getByTestId('peek-toggle'));
    expect(screen.queryByTestId('peek-text')).toBeNull();
    expect(loadPreferences(storage).phoneShowsQuestion).toBe(false);
  });

  it('keeps the other saved preferences when the switch is used', () => {
    const storage = createStorage(null);
    void storage.set('qp.prefs', JSON.stringify({ volume: 0.3, muted: true, locale: 'en' }));
    mount({ storage });
    fireEvent.click(screen.getByTestId('peek-toggle'));
    expect(loadPreferences(storage)).toEqual({
      volume: 0.3,
      muted: true,
      locale: 'en',
      phoneShowsQuestion: true,
    });
  });

  it('tapping an answer sends that option and nothing else', () => {
    const { act } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'C: İzmir' }));
    expect(act.answer).toHaveBeenCalledWith('optionCCCC');
  });

  it('offers 50/50 as a chip with the count, and uses it on tap', () => {
    const { act } = mount();
    const chip = screen.getByTestId('use-fifty');
    expect(chip.textContent).toContain('50/50 kullan');
    expect(chip.textContent).toContain('1');
    fireEvent.click(chip);
    expect(act.fifty).toHaveBeenCalledTimes(1);
  });

  it('the pending tap is shown at once: the pick is framed, the others dim', () => {
    mount({ state: { pendingAnswer: { questionId: 'q1', optionId: 'optionBBBB' } } });
    const cards = [...document.querySelectorAll<HTMLButtonElement>('button[data-answer-index]')];
    expect(cards[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(cards.every((card) => card.disabled)).toBe(true);
  });

  it('locked: the same answers stay on screen, the chosen one is marked locked, nothing can be tapped', () => {
    const { act } = mount({
      me: you('p1', {
        powers: powersOf(),
        answer: { questionId: 'q1', optionId: 'optionCCCC', lockedAt: 1800 },
      }),
    });
    expect(screen.getByTestId('ctl-confirmed')).toBeTruthy();
    expect(screen.getByTestId('ctl-locked-banner').textContent).toContain('Cevabın kilitlendi');
    const cards = [...document.querySelectorAll<HTMLButtonElement>('button[data-answer-index]')];
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(cards[2]!.querySelector('img[data-sticker="lock"]')).toBeTruthy();
    expect(cards.every((card) => card.disabled)).toBe(true);
    fireEvent.click(cards[0]!);
    expect(act.answer).not.toHaveBeenCalled();
    expect(screen.queryByTestId('use-fifty')).toBeNull();
    expect(screen.queryByTestId('peek-toggle')).toBeNull();
  });

  it('after 50/50 the removed options are dimmed and cannot be tapped', () => {
    mount({
      me: you('p1', {
        powers: powersOf({ fiftyFifty: 0 }),
        fiftyFifty: { keep: ['optionAAAA', 'optionCCCC'] },
      }),
    });
    const cards = [...document.querySelectorAll<HTMLButtonElement>('button[data-answer-index]')];
    expect(cards.map((card) => card.disabled)).toEqual([false, true, false, true]);
    expect(screen.getByTestId('fifty-used')).toBeTruthy();
  });
});

describe('the other phases of a question', () => {
  it('while the question is read out the phone points at the TV and keeps the text away', () => {
    mount({
      phaseData: {
        phase: 'QUESTION',
        round: ROUND,
        questionId: 'q1',
        text: QUESTION_TEXT,
        category: { id: 'geography', label: 'Coğrafya' },
        difficulty: 'EASY',
      },
    });
    expect(screen.getByTestId('ctl-question')).toBeTruthy();
    expect(screen.queryByText(QUESTION_TEXT)).toBeNull();
    expect(screen.getByTestId('ctl-tv-hint').textContent).toBe("Soruya TV'den bak");
    fireEvent.click(screen.getByTestId('peek-toggle'));
    expect(screen.getByTestId('peek-text').textContent).toBe(QUESTION_TEXT);
  });

  it('a Who Said It author who sits the round out also gets the text only on request', () => {
    mount({
      me: you('p1', { powers: powersOf(), authorOfRound: true }),
    });
    expect(screen.getByTestId('ctl-sitout')).toBeTruthy();
    expect(screen.queryByText(QUESTION_TEXT)).toBeNull();
    fireEvent.click(screen.getByTestId('peek-toggle'));
    expect(screen.getByTestId('peek-text').textContent).toBe(QUESTION_TEXT);
  });

  it('the reveal stays as it was: the outcome and the correct answer in words', () => {
    mount({
      phaseData: {
        phase: 'REVEAL',
        round: ROUND,
        questionId: 'q1',
        text: QUESTION_TEXT,
        options: OPTIONS,
        correctOptionId: 'optionAAAA',
        explanation: 'Ankara 1923’ten beri başkent.',
        distribution: [],
        results: [{ playerId: 'p1', outcome: 'INCORRECT', optionId: 'optionBBBB' }],
      },
    });
    expect(screen.getByTestId('ctl-outcome').getAttribute('data-outcome')).toBe('INCORRECT');
    expect(screen.getByTestId('ctl-reveal').textContent).toContain('Ankara');
    expect(screen.getByTestId('ctl-reveal').textContent).toContain('Yanlış');
  });
});

describe('the lobby', () => {
  const lobby: PhaseData = { phase: 'LOBBY' };

  it('a guest has one big ready button and no start button', () => {
    const { act } = mount({ phaseData: lobby });
    fireEvent.click(screen.getByTestId('ctl-ready'));
    expect(act.ready).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('ctl-start')).toBeNull();
  });

  it('the leader sees ready and start', () => {
    mount({ phaseData: lobby, me: you('p1', { isLeader: true }) });
    expect(screen.getByTestId('ctl-ready')).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>('ctl-start').disabled).toBe(false);
  });
});

describe('the build default', () => {
  it('is off unless VITE_PHONE_SHOWS_QUESTION is 1 or true', () => {
    expect(phoneShowsQuestionDefault({})).toBe(false);
    expect(phoneShowsQuestionDefault({ VITE_PHONE_SHOWS_QUESTION: '' })).toBe(false);
    expect(phoneShowsQuestionDefault({ VITE_PHONE_SHOWS_QUESTION: '0' })).toBe(false);
    expect(phoneShowsQuestionDefault({ VITE_PHONE_SHOWS_QUESTION: '1' })).toBe(true);
    expect(phoneShowsQuestionDefault({ VITE_PHONE_SHOWS_QUESTION: ' TRUE ' })).toBe(true);
  });

  it('a player’s own choice beats it in both directions', () => {
    const storage = createStorage(null);
    expect(resolveShowQuestion(storage, true)).toBe(true);
    expect(resolveShowQuestion(storage, false)).toBe(false);
    void storage.set('qp.prefs', JSON.stringify({ phoneShowsQuestion: false }));
    expect(resolveShowQuestion(storage, true)).toBe(false);
    void storage.set('qp.prefs', JSON.stringify({ phoneShowsQuestion: true }));
    expect(resolveShowQuestion(storage, false)).toBe(true);
  });

  it('shows the question from the start when the build says so', () => {
    vi.stubEnv('VITE_PHONE_SHOWS_QUESTION', '1');
    try {
      mount();
      expect(screen.getByTestId('peek-text').textContent).toBe(QUESTION_TEXT);
      expect(screen.getByTestId('peek-toggle').textContent).toBe('Soruyu gizle');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
