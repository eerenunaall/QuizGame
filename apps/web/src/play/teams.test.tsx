import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseData, RoomView, TeamId } from '@quizparty/protocol';
import {
  answeringData,
  player,
  roomView,
  ROUND,
  stateWith,
  you,
} from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../lib/i18n';
import { createStorage } from '../lib/storage';
import { Controller, type ControllerActions } from './Controller';
import { PhoneFrame } from './PhoneFrame';

/**
 * ADR-0026 on the phone: the team picker and the leader's play-mode controls in the lobby, the simple
 * ruleset's single prep screen, team standings, and a phone that carries no question text in the simple ruleset.
 */
afterEach(cleanup);

const actions = (): ControllerActions => ({
  ready: vi.fn(),
  start: vi.fn(),
  settings: vi.fn(),
  assignTeam: vi.fn(),
  answer: vi.fn(),
  rematch: vi.fn(),
  backToLobby: vi.fn(),
  leave: vi.fn(),
  kick: vi.fn(),
  makeLeader: vi.fn(),
  commitRisk: vi.fn(() => Promise.resolve()),
  commitSabotage: vi.fn(() => Promise.resolve()),
  fifty: vi.fn(),
  setReduced: vi.fn(),
  submitStatement: vi.fn(() => Promise.resolve()),
});

const teamPlayers = (teams: (TeamId | undefined)[]) =>
  teams.map((teamId, index) =>
    player(index, { nickname: `P${index}`, ...(teamId ? { teamId } : {}) }),
  );

const powersOf = (patch: Record<string, unknown> = {}) => ({
  fiftyFifty: 1,
  doubleDown: 2,
  shield: 1,
  sabotageTokens: 1,
  nextTokenAtStreak: 3,
  lockedJoker: null,
  ...patch,
});

function mount(room: RoomView, act: ControllerActions = actions(), locale: 'tr' | 'en' = 'tr') {
  const result = render(
    <I18nProvider locale={locale}>
      <Controller
        room={room}
        state={stateWith(room)}
        now={() => 2000}
        catalog={null}
        busy={false}
        error={null}
        actions={act}
        storage={createStorage(null)}
      />
    </I18nProvider>,
  );
  return { act, ...result };
}

const lobbyRoom = (over: Partial<RoomView> = {}, me = 'p0'): RoomView =>
  roomView({
    maxPlayers: 8,
    settings: {
      mode: 'CLASSIC',
      contentTitle: null,
      rounds: 5,
      difficulty: 'MEDIUM',
      categories: 'ALL',
      play: 'TEAMS',
      teamCount: 2,
    },
    limits: { maxRounds: 20, teamImbalance: 1 },
    players: teamPlayers(['tiger', 'owl', 'tiger']),
    you: you(me, { isLeader: me === 'p0', canHost: me === 'p0', teamId: 'tiger' }),
    ...over,
  });

describe('the lobby in team play', () => {
  it('offers one chip per team, shows who is in which, and a tap puts you in that team', () => {
    const { act } = mount(lobbyRoom({}, 'p1'));
    expect(screen.getByTestId('team-picker')).toBeTruthy();
    expect(screen.getByTestId('team-chip-tiger').getAttribute('aria-label')).toContain('Kaplanlar');
    expect(screen.getByTestId('team-chip-tiger').textContent).toContain('2 kişi');
    expect(screen.getByTestId('team-chip-owl').getAttribute('aria-pressed')).toBe('true'); // p1 is an owl
    expect(screen.getByTestId('team-chip-tiger').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('team-chip-tiger'));
    expect(act.assignTeam).toHaveBeenCalledWith('tiger');
    // only the teams on offer: 2 teams means no fox chip
    expect(screen.queryByTestId('team-chip-fox')).toBeNull();
  });

  it('marks a full team as full and does not let it be tapped', () => {
    const room = lobbyRoom(
      { maxPlayers: 4, players: teamPlayers(['tiger', 'tiger', 'owl']) },
      'p2',
    );
    const { act } = mount(room);
    const tiger = screen.getByTestId<HTMLButtonElement>('team-chip-tiger');
    expect(tiger.disabled).toBe(true); // capacity of 4 seats over 2 teams is 2
    expect(tiger.textContent).toContain('Dolu');
    fireEvent.click(tiger);
    expect(act.assignTeam).not.toHaveBeenCalled();
  });

  it('shows the venue’s own team name for a slot', () => {
    const room = lobbyRoom({});
    mount({ ...room, settings: { ...room.settings, teamNames: ['Gusto Aslanları'] } }, actions());
    expect(screen.getByTestId('team-chip-tiger').textContent).toContain('Gusto Aslanları');
    expect(screen.getByTestId('team-chip-owl').textContent).toContain('Baykuşlar');
  });

  it('says it in English too', () => {
    mount(lobbyRoom({}, 'p1'), actions(), 'en');
    expect(screen.getByTestId('team-chip-tiger').textContent).toContain('Tigers');
    expect(screen.getByTestId('team-picker').textContent).toContain('Pick your team');
  });

  it('gives a room that plays alone no team chips and no team badge on the roster', () => {
    const room = roomView({ players: [player(0), player(1)], you: you('p1') });
    mount(room);
    expect(screen.queryByTestId('team-picker')).toBeNull();
    expect(document.querySelector('[data-team]')).toBeNull();
  });

  it('lets only the leader change the play mode, the ruleset and the number of teams', () => {
    const asLeader = mount(lobbyRoom({}, 'p0'));
    fireEvent.click(screen.getByText('Bireysel'));
    expect(asLeader.act.settings).toHaveBeenCalledWith({ play: 'INDIVIDUAL' });
    fireEvent.click(screen.getByText('Basit'));
    expect(asLeader.act.settings).toHaveBeenCalledWith({ ruleset: 'SIMPLE' });
    fireEvent.click(screen.getByText('3'));
    expect(asLeader.act.settings).toHaveBeenCalledWith({ teamCount: 3 });
    asLeader.unmount();

    mount(lobbyRoom({}, 'p1'));
    expect(screen.queryByTestId('ctl-play-mode')).toBeNull();
    expect(screen.queryByTestId('ctl-ruleset')).toBeNull();
  });

  it('lets the leader move another player into a team', () => {
    const { act } = mount(lobbyRoom({}, 'p0'));
    fireEvent.click(screen.getByTestId('ctl-player-P1'));
    const move = screen.getByTestId('team-move');
    expect(move.querySelectorAll('button')).toHaveLength(2);
    fireEvent.click(within(move).getByTestId('team-chip-tiger'));
    expect(act.assignTeam).toHaveBeenCalledWith('tiger', 'p1');
  });

  it('keeps start closed with a reason until the teams make a game', () => {
    const lopsided = lobbyRoom({
      maxPlayers: 8,
      players: teamPlayers(['tiger', 'tiger', 'tiger', 'owl']),
    });
    mount(lopsided);
    expect(screen.getByTestId<HTMLButtonElement>('ctl-start').disabled).toBe(true);
    expect(screen.getByTestId('ctl-need').textContent).toContain('dengesiz');
    cleanup();

    mount(lobbyRoom({ players: teamPlayers(['tiger', 'tiger']) }));
    expect(screen.getByTestId<HTMLButtonElement>('ctl-start').disabled).toBe(true);
    expect(screen.getByTestId('ctl-need').textContent).toMatch(/iki takım/u);
    cleanup();

    mount(lobbyRoom({}));
    expect(screen.getByTestId<HTMLButtonElement>('ctl-start').disabled).toBe(false);
  });
});

describe('the team badge of the phone', () => {
  it('shows the team the player plays for next to the room code', () => {
    const room = lobbyRoom({}, 'p1');
    render(
      <I18nProvider locale="tr">
        <PhoneFrame
          room={{ ...room, you: you('p1', { teamId: 'owl' }) }}
          reconnecting={false}
          tvLost={false}
          restored={false}
        >
          <div />
        </PhoneFrame>
      </I18nProvider>,
    );
    expect(screen.getByTestId('phone-team').textContent).toBe('Baykuşlar');
  });
});

// ─────────────────────────── the simple ruleset's prep screen

const PREP: PhaseData = {
  phase: 'RISK_PICK',
  round: { ...ROUND, index: 1 },
  category: { id: 'history', label: 'Tarih' },
  difficulty: 'EASY',
  riskLadder: [{ tier: 'SAFE', multiplier: 1, loss: 0 }],
  stakeMandatory: false,
  doubleDownEnabled: true,
  sabotageEnabled: true,
  combined: true,
  offered: ['JAM', 'SHUFFLE', 'BLIND_CLOCK'],
  committedCount: 0,
  eligibleCount: 4,
};

const teamBoard = [
  { teamId: 'tiger', rank: 1, total: 0, average: 0, members: 2, correctCount: 0 },
  { teamId: 'owl', rank: 1, total: 0, average: 0, members: 2, correctCount: 0 },
] as const;

function prepRoom(meOver: Parameters<typeof you>[1] = {}, teams = true): RoomView {
  return roomView({
    phase: 'RISK_PICK',
    phaseData: PREP,
    phaseEnteredAt: 1_000,
    phaseDeadlineAt: 11_000,
    maxPlayers: 4,
    settings: {
      mode: 'CLASSIC',
      contentTitle: null,
      rounds: 5,
      difficulty: 'MEDIUM',
      categories: 'ALL',
      ruleset: 'SIMPLE',
      ...(teams ? { play: 'TEAMS' as const } : {}),
    },
    players: teamPlayers(
      teams ? ['tiger', 'owl', 'tiger', 'owl'] : [undefined, undefined, undefined],
    ),
    game: {
      gameId: '00000000-0000-4000-8000-000000000001',
      totalRounds: 5,
      roundIndex: 1,
      scoreboard: [],
      ...(teams ? { teamBoard: [...teamBoard] } : {}),
    },
    you: you('p0', {
      ...(teams ? { teamId: 'tiger' as const } : {}),
      powers: powersOf(),
      risk: { ready: true, decided: false },
      sabotage: { ready: true, decided: false },
      ...meOver,
    }),
  });
}

describe('the simple prep screen', () => {
  it('shows Double Down, the three café sabotages and one DONE button, and nothing about stakes', () => {
    mount(prepRoom());
    expect(screen.getByTestId('ctl-simple')).toBeTruthy();
    expect(screen.getByTestId('pick-title').textContent).toBe('HAZIRLAN');
    expect(screen.getByTestId('simple-dd')).toBeTruthy();
    for (const kind of ['JAM', 'SHUFFLE', 'BLIND_CLOCK'])
      expect(screen.getByTestId(`simple-effect-${kind}`)).toBeTruthy();
    expect(screen.queryByTestId('simple-effect-FOG')).toBeNull();
    expect(screen.getByTestId('simple-done')).toBeTruthy();
    expect(screen.queryByText(/bahis/i)).toBeNull();
    expect(document.querySelector('[data-testid^="stake-"]')).toBeNull();
  });

  it('sends the Double Down and a sabotage on a rival team with one tap on DONE', async () => {
    const { act } = mount(prepRoom());
    fireEvent.click(screen.getByTestId('simple-dd'));
    expect(screen.getByTestId('simple-dd').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('simple-effect-JAM'));
    // a team game aims at the rival teams only: never your own
    expect(screen.getByTestId('simple-aim-owl')).toBeTruthy();
    expect(screen.queryByTestId('simple-aim-tiger')).toBeNull();
    fireEvent.click(screen.getByTestId('simple-aim-owl'));
    fireEvent.click(screen.getByTestId('simple-done'));
    await waitFor(() => expect(act.commitSabotage).toHaveBeenCalled());
    expect(act.commitRisk).toHaveBeenCalledWith({ stake: 'SAFE', doubleDown: true });
    expect(act.commitSabotage).toHaveBeenCalledWith({
      sabotage: { targetTeamId: 'owl', effect: 'JAM' },
    });
  });

  it('aims at teams in the first round too, before any standings exist', () => {
    const room = prepRoom();
    mount({ ...room, game: { ...room.game!, teamBoard: undefined } });
    fireEvent.click(screen.getByTestId('simple-effect-JAM'));
    expect(screen.getByTestId('simple-aim-owl')).toBeTruthy();
    expect(screen.queryByTestId('simple-aim-P1')).toBeNull();
  });

  it('aims at a player in individual play', async () => {
    const { act } = mount(prepRoom({}, false));
    fireEvent.click(screen.getByTestId('simple-effect-BLIND_CLOCK'));
    expect(screen.getByTestId('simple-aim-P1')).toBeTruthy();
    expect(screen.queryByTestId('simple-aim-P0')).toBeNull();
    fireEvent.click(screen.getByTestId('simple-aim-P1'));
    fireEvent.click(screen.getByTestId('simple-done'));
    await waitFor(() => expect(act.commitSabotage).toHaveBeenCalled());
    expect(act.commitSabotage).toHaveBeenCalledWith({
      sabotage: { targetId: 'p1', effect: 'BLIND_CLOCK' },
    });
  });

  it('does not send a half-picked sabotage: a card without a rival keeps DONE closed', () => {
    mount(prepRoom());
    fireEvent.click(screen.getByTestId('simple-effect-SHUFFLE'));
    expect(screen.getByTestId<HTMLButtonElement>('simple-done').disabled).toBe(true);
  });

  it('answers "no" for both when nothing is picked', async () => {
    const { act } = mount(prepRoom());
    fireEvent.click(screen.getByTestId('simple-done'));
    await waitFor(() => expect(act.commitSabotage).toHaveBeenCalled());
    expect(act.commitRisk).toHaveBeenCalledWith({ stake: 'SAFE', doubleDown: false });
    expect(act.commitSabotage).toHaveBeenCalledWith({ sabotage: null });
  });

  it('asks only for what is left to decide', async () => {
    const { act } = mount(prepRoom({ risk: { ready: false, decided: true } }));
    expect(screen.queryByTestId('simple-dd')).toBeNull();
    fireEvent.click(screen.getByTestId('simple-done'));
    await waitFor(() => expect(act.commitSabotage).toHaveBeenCalled());
    expect(act.commitRisk).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and lets the player pick another sabotage', async () => {
    const act = actions();
    act.commitSabotage = vi.fn(() =>
      Promise.reject(Object.assign(new Error('x'), { code: 'SABOTAGE_LIMIT' })),
    );
    mount(prepRoom(), act);
    fireEvent.click(screen.getByTestId('simple-effect-JAM'));
    fireEvent.click(screen.getByTestId('simple-aim-owl'));
    fireEvent.click(screen.getByTestId('simple-done'));
    await waitFor(() => expect(screen.getByTestId('prep-error')).toBeTruthy());
    expect(screen.getByTestId('prep-error').textContent).toContain('Sabotaj sınırı');
    // the pick was dropped, the card can be chosen again
    expect(screen.queryByTestId('simple-aims')).toBeNull();
  });

  it('is a calm screen for a player with nothing to use, and does not ask them for anything', () => {
    mount(
      prepRoom({
        risk: { ready: false, decided: false },
        sabotage: { ready: false, decided: false },
        powers: powersOf({ doubleDown: 0, sabotageTokens: 0 }),
      }),
    );
    expect(screen.getByTestId('ctl-simple-wait')).toBeTruthy();
    expect(screen.queryByTestId('simple-done')).toBeNull();
  });

  it('says "you are ready" once everything was decided', () => {
    mount(
      prepRoom({
        risk: { ready: true, decided: true },
        sabotage: { ready: false, decided: true },
        commitment: {
          stake: 'SAFE',
          doubleDown: true,
          sabotage: { targetTeamId: 'owl', effect: 'JAM' },
        },
      }),
    );
    expect(screen.getByTestId('ctl-simple-done').textContent).toContain('Hazırsın');
    expect(screen.getByTestId('ctl-simple-done').textContent).toContain('Baykuşlar');
  });
});

// ─────────────────────────── a phone with no question text

describe('the simple ruleset keeps the question on the TV', () => {
  const options = [
    { optionId: 'optionAAAA', text: 'Ankara' },
    { optionId: 'optionBBBB', text: 'Bursa' },
    { optionId: 'optionCCCC', text: 'Konya' },
    { optionId: 'optionDDDD', text: 'Adana' },
  ];
  const hidden = answeringData({ text: '', options });

  it('keeps the answer options on the phone, and gives no way to reveal the question', () => {
    const room = roomView({
      phase: 'ANSWERING',
      phaseData: hidden,
      players: [player(0), player(1)],
      you: you('p1', { powers: powersOf() }),
    });
    mount(room);
    const cards = [...document.querySelectorAll<HTMLElement>('button[data-answer-index]')];
    expect(cards).toHaveLength(4);
    for (const [index, card] of cards.entries()) {
      expect(card.textContent).toContain(options[index]!.text);
      expect(card.querySelector('svg[data-shape]')).toBeTruthy();
    }
    expect(screen.queryByTestId('peek-toggle')).toBeNull();
    expect(screen.getByTestId('ctl-tv-hint')).toBeTruthy();
  });

  it('is still the rule in the full ruleset that the question text is off unless asked for', () => {
    const room = roomView({
      phase: 'ANSWERING',
      phaseData: answeringData({ text: 'Başkent?' }),
      players: [player(0), player(1)],
      you: you('p1', { powers: powersOf() }),
    });
    mount(room);
    expect(screen.queryByText('Başkent?')).toBeNull();
    expect(screen.getByTestId('peek-toggle')).toBeTruthy();
  });
});

// ─────────────────────────── standings

describe('team standings on the phone', () => {
  it('shows the team’s rank and average after a question, and the teams instead of the players', () => {
    const data: PhaseData = {
      phase: 'SCORE_UPDATE',
      round: ROUND,
      deltas: [
        { playerId: 'p0', delta: 120, total: 120, rank: 1, previousRank: 1, components: [] },
      ],
      scoreboard: [],
      teamBoard: [
        { teamId: 'owl', rank: 1, total: 900, average: 450, members: 2, correctCount: 4 },
        { teamId: 'tiger', rank: 2, total: 800, average: 267, members: 3, correctCount: 3 },
      ],
    };
    const room = roomView({
      phase: 'SCORE_UPDATE',
      phaseData: data,
      players: teamPlayers(['tiger', 'owl', 'tiger']),
      you: you('p0', { teamId: 'tiger' }),
    });
    mount(room);
    expect(screen.getByTestId('ctl-team-rank').textContent).toContain('2. sırada');
    expect(screen.getByTestId('ctl-team-rank').textContent).toContain('267');
    expect(screen.getByTestId('ctl-team-row-owl').textContent).toContain('450');
    expect(screen.getByTestId('ctl-team-row-tiger').textContent).toContain('267');
  });

  it('shows the final team ranking and marks the player’s own team', () => {
    const data: PhaseData = {
      phase: 'RESULTS',
      ranking: [
        { playerId: 'p0', score: 300, rank: 1, correctCount: 3, bestStreak: 2 },
        { playerId: 'p1', score: 100, rank: 2, correctCount: 1, bestStreak: 1 },
      ],
      awards: [],
      teamRanking: [
        { teamId: 'tiger', rank: 1, total: 300, average: 300, members: 1, correctCount: 3 },
        { teamId: 'owl', rank: 2, total: 100, average: 100, members: 1, correctCount: 1 },
      ],
    };
    const room = roomView({
      phase: 'RESULTS',
      phaseData: data,
      players: teamPlayers(['tiger', 'owl']),
      you: you('p0', { teamId: 'tiger' }),
    });
    mount(room);
    expect(screen.getByTestId('ctl-team-final-tiger').textContent).toContain('300');
    expect(screen.getByTestId('ctl-team-final-owl').textContent).toContain('100');
  });
});
