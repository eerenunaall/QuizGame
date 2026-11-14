import {
  MIN_TEAMS,
  TEAM_IDS,
  type ErrorCode,
  type LobbySettings,
  type PlayMode,
  type Ruleset,
  type TeamId,
  type TeamStanding,
} from '@quizparty/protocol';
import { teamRules } from './config';
import type { GameState, RoomState } from './types';

/**
 * Teams (ADR-0026). Everything here is pure: players still answer and score on their own, a team is a
 * grouping the engine fixes when the game starts and reads when it ranks. Optional state fields mean a
 * room stored before teams existed plays exactly as it did (individual, full ruleset).
 */

export const playModeOf = (settings: Pick<LobbySettings, 'play'>): PlayMode =>
  settings.play ?? 'INDIVIDUAL';
export const rulesetOf = (settings: Pick<LobbySettings, 'ruleset'>): Ruleset =>
  settings.ruleset ?? 'FULL';
export const teamCountOf = (settings: Pick<LobbySettings, 'teamCount'>): number =>
  settings.teamCount ?? MIN_TEAMS;

/** Whether the room (lobby) plays in teams. */
export const teamPlay = (state: Pick<RoomState, 'settings'>): boolean =>
  playModeOf(state.settings) === 'TEAMS';

/** Whether the running game is a team game. */
export const gameHasTeams = (game: Pick<GameState, 'teams'> | null | undefined): boolean =>
  game?.teams !== undefined;

/** The team slots a lobby offers: the first `teamCount` of `TEAM_IDS`. */
export function lobbyTeamIds(settings: Pick<LobbySettings, 'teamCount'>): TeamId[] {
  return TEAM_IDS.slice(0, teamCountOf(settings));
}

/**
 * Most players one team may hold: the room's seats shared out evenly (rounded up), so an offered team
 * can always take a player as long as the room has a seat, and no team can hold the whole room.
 */
export function teamCapacity(maxPlayers: number, teamCount: number): number {
  return Math.ceil(maxPlayers / teamCount);
}

type LobbyView = Pick<RoomState, 'settings' | 'players' | 'playerOrder' | 'config'>;

/** Active players per offered team, in slot order (zero for an empty team). */
export function teamSizes(state: LobbyView): Record<string, number> {
  const sizes: Record<string, number> = Object.fromEntries(
    lobbyTeamIds(state.settings).map((id) => [id, 0]),
  );
  for (const id of state.playerOrder) {
    const player = state.players[id];
    if (player?.status === 'ACTIVE' && player.teamId !== undefined && player.teamId in sizes)
      sizes[player.teamId] = (sizes[player.teamId] ?? 0) + 1;
  }
  return sizes;
}

/** The offered team with the fewest players, ties to the earlier slot (where a new or unassigned player goes). */
export function smallestTeam(
  state: LobbyView,
  sizes: Record<string, number> = teamSizes(state),
): TeamId {
  const ids = lobbyTeamIds(state.settings);
  return ids.reduce((best, id) => ((sizes[id] ?? 0) < (sizes[best] ?? 0) ? id : best), ids[0]!);
}

/**
 * Whether a game in teams may start (ADR-0026 §2): at least two teams with players, and no team more
 * than `maxImbalance` players larger than the smallest team that has any. Empty offered teams are not
 * part of the game, so a table of 4 with `teamCount` 3 may simply play as two teams of two.
 */
export function teamsStartCheck(state: LobbyView): ErrorCode | null {
  const sizes = Object.values(teamSizes(state)).filter((size) => size > 0);
  if (sizes.length < MIN_TEAMS) return 'NOT_ENOUGH_TEAMS';
  if (Math.max(...sizes) - Math.min(...sizes) > teamRules(state.config).maxImbalance)
    return 'TEAMS_UNBALANCED';
  return null;
}

export interface TeamMemberScore {
  score: number;
  correctCount: number;
  totalRemainingMs: number;
}

/**
 * Team standings (ADR-0026 §4). The ranking key is the average points per active member (rounded half
 * up, the number the screens show), then correct answers per member, then time left per member (all
 * compared exactly, by cross-multiplication). Teams equal on all three share a rank. `total` is reported
 * beside the average. A team with no members is not ranked at all.
 */
export function rankTeams(
  teams: readonly { teamId: TeamId; members: readonly TeamMemberScore[] }[],
): TeamStanding[] {
  const rows = teams
    .filter((team) => team.members.length > 0)
    .map((team) => {
      const members = team.members.length;
      const total = team.members.reduce((sum, m) => sum + m.score, 0);
      return {
        teamId: team.teamId,
        members,
        total,
        // Integer arithmetic only (determinism): floor((2 * total + n) / (2 * n)) = round half up.
        average: Math.floor((2 * total + members) / (2 * members)),
        correctCount: team.members.reduce((sum, m) => sum + m.correctCount, 0),
        remaining: team.members.reduce((sum, m) => sum + m.totalRemainingMs, 0),
      };
    });
  // Per-member comparisons without division: b.x / b.n against a.x / a.n.
  rows.sort(
    (a, b) =>
      b.average - a.average ||
      b.correctCount * a.members - a.correctCount * b.members ||
      b.remaining * a.members - a.remaining * b.members ||
      TEAM_IDS.indexOf(a.teamId) - TEAM_IDS.indexOf(b.teamId),
  );
  const tied = (a: (typeof rows)[number], b: (typeof rows)[number]): boolean =>
    a.average === b.average &&
    a.correctCount * b.members === b.correctCount * a.members &&
    a.remaining * b.members === b.remaining * a.members;
  const out: TeamStanding[] = [];
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    const rank = previous && tied(previous, row) ? out[index - 1]!.rank : index + 1;
    out.push({
      teamId: row.teamId,
      rank,
      total: row.total,
      average: row.average,
      members: row.members,
      correctCount: row.correctCount,
    });
  });
  return out;
}

/** Players of `teamId` still in the running game: seated (active) and not removed. */
export function activeTeamMembers(
  state: Pick<RoomState, 'players' | 'playerOrder'>,
  game: Pick<GameState, 'players'>,
  teamId: TeamId,
): string[] {
  return state.playerOrder.filter((playerId) => {
    const gp = game.players[playerId];
    return (
      gp !== undefined &&
      gp.teamId === teamId &&
      !gp.removed &&
      state.players[playerId]?.status === 'ACTIVE'
    );
  });
}

/** Standings of the running game from the players' current scores; empty for an individual game. */
export function teamStandings(
  state: Pick<RoomState, 'players' | 'playerOrder'>,
  game: Pick<GameState, 'players' | 'teams'> | null | undefined,
): TeamStanding[] {
  if (!game?.teams) return [];
  return rankTeams(
    game.teams.ids.map((teamId) => ({
      teamId,
      members: activeTeamMembers(state, game, teamId).map((playerId) => {
        const gp = game.players[playerId]!;
        return {
          score: gp.score,
          correctCount: gp.correctCount,
          totalRemainingMs: gp.totalRemainingMs,
        };
      }),
    })),
  );
}

/** The team a player plays for in the running game, if it is a team game. */
export const gameTeamOf = (
  game: Pick<GameState, 'players' | 'teams'> | null | undefined,
  playerId: string,
): TeamId | undefined => (game?.teams ? game.players[playerId]?.teamId : undefined);
