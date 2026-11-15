import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseData, PhaseDataOf, RoomView, TeamId } from '@quizparty/protocol';
import { player, roomView, ROUND } from '@quizparty/controller-client/fixtures';
import { I18nProvider } from '../../lib/i18n';
import { TvRiskPick } from './TvInterstitials';
import { TvLobby } from './TvLobby';
import { TvPowerResolution } from './TvPower';
import { TvResults } from './TvResults';
import { TvScoreUpdate } from './TvScore';
import { TvSettings } from './TvSettings';

/** ADR-0026 on the TV: teams in the lobby, standings, the team podium, a hit on a team, the single prep. */
afterEach(cleanup);

const wrap = (node: React.ReactElement, locale: 'tr' | 'en' = 'tr') =>
  render(<I18nProvider locale={locale}>{node}</I18nProvider>);

const teamPlayers = (teams: TeamId[]) =>
  teams.map((teamId, index) => player(index, { nickname: `P${index}`, teamId }));

const settings = (over: Partial<RoomView['settings']> = {}): RoomView['settings'] => ({
  mode: 'CLASSIC',
  contentTitle: null,
  rounds: 5,
  difficulty: 'MEDIUM',
  categories: 'ALL',
  play: 'TEAMS',
  teamCount: 2,
  ...over,
});

const lobby = (teams: TeamId[], over: Partial<RoomView> = {}): RoomView =>
  roomView({
    maxPlayers: 8,
    settings: settings(),
    limits: { maxRounds: 20, teamImbalance: 1 },
    players: teamPlayers(teams),
    ...over,
  });

const tvLobby = (room: RoomView) => (
  <TvLobby
    room={room}
    joinUrl="https://x.test/join/ABC234"
    joinLabel="x.test/join"
    starting={false}
    error={null}
    onStart={vi.fn()}
    onOpenSettings={vi.fn()}
    onOpenUnlock={vi.fn()}
    categoryLabel="Karışık"
  />
);

describe('the TV lobby in team play', () => {
  it('shows a column per team with its members and empty seats', () => {
    wrap(tvLobby(lobby(['tiger', 'owl', 'tiger'])));
    const tiger = screen.getByTestId('lobby-team-tiger');
    expect(within(tiger).getByText('Kaplanlar')).toBeTruthy();
    expect(within(tiger).getByText('P0')).toBeTruthy();
    expect(within(tiger).getByText('P2')).toBeTruthy();
    expect(tiger.textContent).toContain('2 kişi');
    expect(screen.getByTestId('lobby-team-owl').textContent).toContain('1 kişi');
    expect(screen.queryByTestId('lobby-team-fox')).toBeNull();
    // the plain player grid is replaced, not repeated
    expect(screen.queryByTestId('lobby-players')).toBeNull();
    expect(screen.getByTestId('lobby-play').textContent).toContain('Takım');
  });

  it('says the teams are balanced and lets the game start', () => {
    wrap(tvLobby(lobby(['tiger', 'owl', 'tiger'])));
    expect(screen.getByTestId('lobby-balance').getAttribute('data-ok')).toBe('true');
    expect(screen.getByTestId<HTMLButtonElement>('lobby-start').disabled).toBe(false);
  });

  it('warns about lopsided teams, names them, and keeps start closed', () => {
    wrap(tvLobby(lobby(['tiger', 'tiger', 'tiger', 'owl'])));
    const note = screen.getByTestId('lobby-balance');
    expect(note.getAttribute('data-ok')).toBe('false');
    expect(note.textContent).toContain('Kaplanlar');
    expect(note.textContent).toContain('Baykuşlar');
    expect(screen.getByTestId<HTMLButtonElement>('lobby-start').disabled).toBe(true);
  });

  it('wants two teams with players', () => {
    wrap(tvLobby(lobby(['tiger', 'tiger'])));
    expect(screen.getByTestId('lobby-balance').textContent).toContain('iki takım');
    expect(screen.getByTestId<HTMLButtonElement>('lobby-start').disabled).toBe(true);
  });

  it('follows the gap the server allows', () => {
    const room = lobby(['tiger', 'tiger', 'tiger', 'owl'], {
      limits: { maxRounds: 20, teamImbalance: 2 },
    });
    wrap(tvLobby(room));
    expect(screen.getByTestId('lobby-balance').getAttribute('data-ok')).toBe('true');
  });

  it('uses the venue’s name for a team and offers more columns for more teams', () => {
    const room = lobby(['tiger', 'owl', 'fox'], {
      settings: settings({ teamCount: 3, teamNames: ['Gusto Aslanları'] }),
    });
    wrap(tvLobby(room));
    expect(
      within(screen.getByTestId('lobby-team-tiger')).getByText('Gusto Aslanları'),
    ).toBeTruthy();
    expect(screen.getByTestId('lobby-team-fox')).toBeTruthy();
  });

  it('is the old lobby for a room that plays alone', () => {
    wrap(tvLobby(roomView({ players: [player(0), player(1)] })));
    expect(screen.getByTestId('lobby-players')).toBeTruthy();
    expect(screen.queryByTestId('lobby-teams')).toBeNull();
    expect(screen.queryByTestId('lobby-play')).toBeNull();
  });
});

describe('the TV settings in team play', () => {
  it('lets the host choose play mode, number of teams and the ruleset', () => {
    const onChange = vi.fn();
    wrap(
      <TvSettings
        room={lobby(['tiger', 'owl'])}
        catalog={null}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );
    const options = screen.getByTestId('tv-play-options');
    within(options).getByText('Bireysel').click();
    expect(onChange).toHaveBeenCalledWith({ play: 'INDIVIDUAL' });
    within(options).getByText('Basit').click();
    expect(onChange).toHaveBeenCalledWith({ ruleset: 'SIMPLE' });
    within(options).getByText('3').click();
    expect(onChange).toHaveBeenCalledWith({ teamCount: 3 });
  });
});

describe('team standings on the TV', () => {
  const data: PhaseDataOf<'SCORE_UPDATE'> = {
    phase: 'SCORE_UPDATE',
    round: ROUND,
    deltas: [
      { playerId: 'p0', delta: 150, total: 150, rank: 1, previousRank: 1, components: [] },
      { playerId: 'p1', delta: 0, total: 0, rank: 4, previousRank: 4, components: [] },
      { playerId: 'p2', delta: -50, total: 50, rank: 3, previousRank: 3, components: [] },
    ],
    scoreboard: [],
    teamBoard: [
      { teamId: 'tiger', rank: 1, total: 200, average: 100, members: 2, correctCount: 1 },
      { teamId: 'owl', rank: 2, total: 0, average: 0, members: 1, correctCount: 0 },
    ],
  };
  const room = roomView({ players: teamPlayers(['tiger', 'owl', 'tiger']), settings: settings() });

  it('ranks the teams by average, with the total beside it and each member’s gain', () => {
    wrap(<TvScoreUpdate room={room} data={data} />);
    expect(screen.getByText('TAKIM PUANLARI')).toBeTruthy();
    const tiger = screen.getByTestId('team-row-tiger');
    expect(tiger.getAttribute('data-rank')).toBe('1');
    expect(tiger.textContent).toContain('toplam 200');
    expect(tiger.textContent).toContain('+150');
    expect(tiger.textContent).toContain('-50');
    expect(screen.getByTestId('team-row-owl').getAttribute('data-rank')).toBe('2');
    const order = [...document.querySelectorAll('[data-testid^="team-row-"]')].map((row) =>
      row.getAttribute('data-testid'),
    );
    expect(order).toEqual(['team-row-tiger', 'team-row-owl']);
    expect(screen.queryByTestId('score-row-P0')).toBeNull();
  });

  it('gives a one-player team and a two-team game the same board', () => {
    wrap(<TvScoreUpdate room={room} data={data} />);
    expect(screen.getByTestId('team-row-owl').textContent).toContain('toplam 0');
  });
});

describe('the TV results in team play', () => {
  const data: PhaseDataOf<'RESULTS'> = {
    phase: 'RESULTS',
    ranking: [
      { playerId: 'p0', score: 400, rank: 1, correctCount: 4, bestStreak: 3 },
      { playerId: 'p2', score: 100, rank: 2, correctCount: 1, bestStreak: 1 },
      { playerId: 'p1', score: 250, rank: 3, correctCount: 2, bestStreak: 1 },
    ],
    awards: [{ kind: 'SHARPSHOOTER', playerId: 'p0' }],
    teamRanking: [
      { teamId: 'owl', rank: 1, total: 250, average: 250, members: 1, correctCount: 2 },
      { teamId: 'tiger', rank: 2, total: 500, average: 250, members: 2, correctCount: 5 },
    ],
  };
  const room = roomView({ players: teamPlayers(['tiger', 'owl', 'tiger']), settings: settings() });
  const props = { onRematch: vi.fn(), onLobby: vi.fn(), onEnd: vi.fn(), busy: false };

  it('puts the teams on the podium, names the winner, and lists the players beside it', () => {
    wrap(<TvResults room={room} data={data} {...props} />);
    expect(screen.getByRole('heading').textContent).toBe('Baykuşlar kazandı!');
    expect(within(screen.getByTestId('podium-1')).getByText('Baykuşlar')).toBeTruthy();
    expect(within(screen.getByTestId('podium-2')).getByText('Kaplanlar')).toBeTruthy();
    expect(screen.getByTestId('podium-2').textContent).toContain('toplam 500');
    expect(screen.getByTestId('tv-results-players').textContent).toContain('P0');
    expect(screen.queryByTestId('tv-results-mascot')).toBeNull();
  });

  it('keeps the old podium of players when nothing was played in teams', () => {
    const { teamRanking: _teams, ...alone } = data;
    wrap(
      <TvResults
        room={roomView({ players: [player(0), player(1), player(2)] })}
        data={alone}
        {...props}
      />,
    );
    expect(within(screen.getByTestId('podium-1')).getByText('Player0')).toBeTruthy();
    expect(screen.getByTestId('tv-results-mascot')).toBeTruthy();
    expect(screen.queryByTestId('tv-results-players')).toBeNull();
  });
});

describe('a sabotage on a team (POWER_RESOLUTION)', () => {
  it('shows one card naming the team, not a player', () => {
    const data: PhaseDataOf<'POWER_RESOLUTION'> = {
      phase: 'POWER_RESOLUTION',
      round: ROUND,
      items: [
        { kind: 'SABOTAGE', actorId: 'p0', targetTeamId: 'owl', effect: 'JAM', blocked: false },
      ],
    };
    wrap(<TvPowerResolution room={lobby(['tiger', 'owl'])} data={data} />);
    const card = screen.getByTestId('power-item');
    expect(card.textContent).toContain('Süre kes');
    expect(card.textContent).toContain('P0 → Baykuşlar');
    expect(card.querySelector('[data-team="owl"]')).toBeTruthy();
  });

  it('shows the shield stopping a hit on a team', () => {
    const data: PhaseDataOf<'POWER_RESOLUTION'> = {
      phase: 'POWER_RESOLUTION',
      round: ROUND,
      items: [
        {
          kind: 'SABOTAGE',
          actorId: 'p0',
          targetTeamId: 'owl',
          effect: 'BLIND_CLOCK',
          blocked: true,
        },
      ],
    };
    wrap(<TvPowerResolution room={lobby(['tiger', 'owl'])} data={data} />);
    expect(screen.getByTestId('power-item').getAttribute('data-blocked')).toBe('true');
  });
});

describe('the TV during the single prep phase of the simple ruleset', () => {
  const prep: PhaseDataOf<'RISK_PICK'> = {
    phase: 'RISK_PICK',
    round: ROUND,
    category: { id: 'history', label: 'Tarih' },
    difficulty: 'EASY',
    riskLadder: [{ tier: 'SAFE', multiplier: 1, loss: 0 }],
    stakeMandatory: false,
    doubleDownEnabled: true,
    sabotageEnabled: true,
    combined: true,
    offered: ['JAM', 'SHUFFLE', 'BLIND_CLOCK'],
    committedCount: 1,
    eligibleCount: 4,
  };

  it('shows the powers on offer and a count of those who are ready, never a ladder', () => {
    wrap(<TvRiskPick data={prep} now={() => 0} startAt={0} deadlineAt={10_000} />);
    expect(screen.getByTestId('tv-simple-prep')).toBeTruthy();
    expect(screen.getByTestId('tv-pick-title').textContent).toBe('HAZIRLAN');
    for (const kind of ['JAM', 'SHUFFLE', 'BLIND_CLOCK'])
      expect(screen.getByTestId(`tv-simple-${kind}`)).toBeTruthy();
    expect(screen.queryByTestId('tv-ladder')).toBeNull();
    expect(screen.getByTestId('tv-pick-progress').textContent).toContain('1/4');
  });

  it('is the old RISK TIME screen when the phase is not combined', () => {
    const old: PhaseData = { ...prep };
    delete (old as { combined?: boolean }).combined;
    wrap(<TvRiskPick data={old} now={() => 0} startAt={0} deadlineAt={10_000} />);
    expect(screen.getByTestId('tv-risk')).toBeTruthy();
    expect(screen.getByTestId('tv-ladder')).toBeTruthy();
  });
});
