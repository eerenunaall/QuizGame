import {
  MIN_TEAMS,
  TEAM_IDS,
  teamColorSlot,
  type LobbySettings,
  type PublicPlayer,
  type RoomView,
  type TeamId,
} from '@quizparty/protocol';
import { playerColor } from '@quizparty/ui-tokens';
import type { Translator } from '@quizparty/i18n';

/**
 * Team helpers for the screens (ADR-0026). The server decides everything (who is in which team, whether
 * the game may start); these only read the room view the same way on the TV and the phone.
 */

/** Whether the room plays in teams (a room that never asked reads as individual play). */
export const isTeamRoom = (room: Pick<RoomView, 'settings'>): boolean =>
  room.settings.play === 'TEAMS';

/** Whether the simple ruleset is on. */
export const isSimpleRoom = (room: Pick<RoomView, 'settings'>): boolean =>
  room.settings.ruleset === 'SIMPLE';

export const teamCount = (settings: Pick<LobbySettings, 'teamCount'>): number =>
  settings.teamCount ?? MIN_TEAMS;

/** The team slots the lobby offers, in order. */
export function offeredTeams(room: Pick<RoomView, 'settings'>): TeamId[] {
  return TEAM_IDS.slice(0, teamCount(room.settings));
}

/** The name shown for a team: the venue's own for that slot, else ours in the player's language. */
export function teamName(
  settings: Pick<LobbySettings, 'teamNames'>,
  teamId: TeamId,
  t: Translator,
): string {
  const custom = settings.teamNames?.[TEAM_IDS.indexOf(teamId)]?.trim();
  return custom ? custom : t(`team.${teamId}`);
}

/** Team colour (the player colour of the same slot, so it keeps its colour-blind checks). */
export const teamColor = (teamId: TeamId): string => playerColor(teamColorSlot(teamId));

export function membersOf(room: Pick<RoomView, 'players'>, teamId: TeamId): PublicPlayer[] {
  return room.players.filter((player) => player.teamId === teamId);
}

/** Most players one team may hold: the room's seats shared out evenly, rounded up (the server's rule). */
export function teamCapacity(room: Pick<RoomView, 'maxPlayers' | 'settings'>): number {
  return Math.ceil(room.maxPlayers / teamCount(room.settings));
}

export type TeamsCheck =
  | { ok: true }
  | { ok: false; reason: 'FEW' }
  | { ok: false; reason: 'LOPSIDED'; big: TeamId; small: TeamId };

/**
 * Whether the teams make a game: two teams with players, no team more than the allowed gap larger than
 * the smallest one that has any. The server checks again at the start; this only explains it early.
 */
export function teamsCheck(room: Pick<RoomView, 'players' | 'settings' | 'limits'>): TeamsCheck {
  const sizes = offeredTeams(room)
    .map((teamId) => ({ teamId, size: membersOf(room, teamId).length }))
    .filter((entry) => entry.size > 0);
  if (sizes.length < MIN_TEAMS) return { ok: false, reason: 'FEW' };
  const big = sizes.reduce((a, b) => (b.size > a.size ? b : a));
  const small = sizes.reduce((a, b) => (b.size < a.size ? b : a));
  if (big.size - small.size > (room.limits.teamImbalance ?? 1))
    return { ok: false, reason: 'LOPSIDED', big: big.teamId, small: small.teamId };
  return { ok: true };
}
