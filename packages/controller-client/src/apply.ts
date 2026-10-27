import type { PhaseData, PublicPlayer, RoomView, ServerMessage, TeamId } from '@quizparty/protocol';
import type { ClientState } from './types';

const byJoinOrder = (a: PublicPlayer, b: PublicPlayer): number => a.joinIndex - b.joinIndex;

function withTeam(
  you: NonNullable<RoomView['you']>,
  teamId: TeamId | null,
): NonNullable<RoomView['you']> {
  const { teamId: _previous, ...rest } = you;
  return teamId === null ? rest : { ...rest, teamId };
}

function withRoom(state: ClientState, change: (room: RoomView) => RoomView): ClientState {
  return state.room ? { ...state, room: change(state.room) } : state;
}

/** Team play (ADR-0026): the standings follow each score update; between them the last ones stand. */
function teamBoardOf(
  room: RoomView,
  data: PhaseData,
): Pick<NonNullable<RoomView['game']>, 'teamBoard'> {
  const board = data.phase === 'SCORE_UPDATE' ? data.teamBoard : room.game?.teamBoard;
  return board ? { teamBoard: board } : {};
}

function updateGame(room: RoomView, data: PhaseData): RoomView['game'] {
  const roundIndex = 'round' in data ? data.round.index : (room.game?.roundIndex ?? -1);
  const total = 'round' in data ? data.round.total : (room.game?.totalRounds ?? 0);
  if (room.game === null && total === 0) return null;
  return {
    gameId: room.game?.gameId ?? '00000000-0000-4000-8000-000000000000',
    totalRounds: total,
    roundIndex,
    scoreboard: data.phase === 'SCORE_UPDATE' ? data.scoreboard : (room.game?.scoreboard ?? []),
    ...teamBoardOf(room, data),
  };
}

/**
 * Pure reducer from server messages to client state. Both snapshots (`ROOM_JOINED`, `RECONNECTED`,
 * `ROOM_STATE`) and incremental events end up in the same `RoomView`, so reconnecting uses exactly
 * the same rendering path as live play. Stale state-bearing messages (older `stateVersion`) are
 * ignored.
 */
export function applyServerMessage(
  state: ClientState,
  message: ServerMessage,
  now: number,
): ClientState {
  switch (message.type) {
    case 'ROOM_JOINED':
    case 'RECONNECTED':
    case 'ROOM_STATE':
      return {
        ...state,
        room: message.payload.room,
        error: null,
        closedReason: null,
        restoredAt: message.type === 'RECONNECTED' ? now : state.restoredAt,
        pendingAnswer: null,
      };

    case 'PHASE_ENTERED': {
      const room = state.room;
      if (!room) return state;
      if (message.stateVersion !== undefined && message.stateVersion < room.stateVersion)
        return state;
      const { data, phaseEnteredAt, phaseDeadlineAt } = message.payload;
      const resetReady = data.phase === 'LOBBY' || data.phase === 'COUNTDOWN';
      const keepReward = data.phase === 'RESULTS';
      return {
        ...state,
        venueReward: keepReward ? state.venueReward : null,
        venueRewardWinner: keepReward ? state.venueRewardWinner : null,
        pendingAnswer: data.phase === 'ANSWERING' ? null : state.pendingAnswer,
        answerRejection: data.phase === 'ANSWERING' ? null : state.answerRejection,
        room: {
          ...room,
          stateVersion: message.stateVersion ?? room.stateVersion,
          phase: data.phase,
          phaseEnteredAt,
          phaseDeadlineAt,
          phaseData: data,
          game: updateGame(room, data),
          players: resetReady
            ? room.players.map((p) => (p.ready ? { ...p, ready: false } : p))
            : room.players,
          you: room.you && data.phase === 'ANSWERING' ? { ...room.you, answer: null } : room.you,
        },
      };
    }

    case 'PLAYER_JOINED':
      return withRoom(state, (room) => ({
        ...room,
        players: [
          ...room.players.filter((p) => p.playerId !== message.payload.player.playerId),
          message.payload.player,
        ].sort(byJoinOrder),
      }));

    case 'PLAYER_LEFT':
      return withRoom(state, (room) => ({
        ...room,
        players: room.players.filter((p) => p.playerId !== message.payload.playerId),
      }));

    case 'PLAYER_STATUS':
      return withRoom(state, (room) => ({
        ...room,
        players: room.players.map((p) =>
          p.playerId === message.payload.playerId
            ? { ...p, connection: message.payload.connection, ready: message.payload.ready }
            : p,
        ),
      }));

    case 'LEADER_CHANGED':
      return withRoom(state, (room) => ({
        ...room,
        players: room.players.map((p) => ({
          ...p,
          isLeader: p.playerId === message.payload.playerId,
        })),
        you: room.you
          ? {
              ...room.you,
              isLeader: room.you.playerId === message.payload.playerId,
              canHost: room.you.playerId === message.payload.playerId,
            }
          : room.you,
      }));

    case 'TEAM_CHANGED':
      return withRoom(state, (room) => ({
        ...room,
        players: room.players.map((p) => {
          if (p.playerId !== message.payload.playerId) return p;
          const { teamId: _previous, ...rest } = p;
          return message.payload.teamId === null
            ? rest
            : { ...rest, teamId: message.payload.teamId };
        }),
        you:
          room.you && room.you.playerId === message.payload.playerId
            ? withTeam(room.you, message.payload.teamId)
            : room.you,
      }));

    case 'NICKNAME_CHANGED':
      return withRoom(state, (room) => ({
        ...room,
        players: room.players.map((p) =>
          p.playerId === message.payload.playerId
            ? { ...p, nickname: message.payload.nickname }
            : p,
        ),
      }));

    case 'SETTINGS_CHANGED':
      return withRoom(state, (room) => ({ ...room, settings: message.payload.settings }));

    case 'DISPLAY_STATUS':
      return withRoom(state, (room) => ({
        ...room,
        displayConnected: message.payload.connected,
        awaitingDisplay: message.payload.awaitingDisplay,
      }));

    case 'ENTITLEMENT_CHANGED':
      return withRoom(
        {
          ...state,
          unlockLink: null,
          entitlement: { tier: message.payload.tier, reason: message.payload.reason, at: now },
        },
        (room) => ({ ...room, tier: message.payload.tier }),
      );

    case 'UNLOCK_LINK':
      return { ...state, unlockLink: message.payload };

    case 'VENUE_METER_CHANGED':
      return withRoom(state, (room) => ({ ...room, venue: message.payload.venue }));

    // A reward belongs to the results it was issued on; leaving them (PHASE_ENTERED) clears it.
    case 'VENUE_REWARD':
      return { ...state, venueReward: message.payload };

    case 'VENUE_REWARD_ISSUED':
      return {
        ...state,
        venueRewardWinner: {
          playerId: message.payload.playerId,
          ...(message.payload.teamId !== undefined ? { teamId: message.payload.teamId } : {}),
        },
      };

    case 'PREP_PROGRESS':
      return withRoom(state, (room) => {
        const data = room.phaseData;
        if (data.phase !== 'RISK_PICK' && data.phase !== 'SABOTAGE_PICK') return room;
        return {
          ...room,
          phaseData: {
            ...data,
            committedCount: message.payload.committedCount,
            eligibleCount: message.payload.eligibleCount,
          },
        };
      });

    case 'STATEMENTS_CHANGED':
      return withRoom(state, (room) =>
        room.phaseData.phase === 'LOBBY'
          ? {
              ...room,
              phaseData: { ...room.phaseData, statementPlayerIds: message.payload.playerIds },
            }
          : room,
      );

    case 'ANSWER_LOCKED':
      return withRoom(state, (room) => {
        const data = room.phaseData;
        if (data.phase !== 'ANSWERING' || data.answeredPlayerIds.includes(message.payload.playerId))
          return room;
        return {
          ...room,
          phaseData: {
            ...data,
            answeredPlayerIds: [...data.answeredPlayerIds, message.payload.playerId],
          },
        };
      });

    case 'ANSWER_ACCEPTED':
      return {
        ...state,
        pendingAnswer: null,
        answerRejection: null,
        room: state.room?.you
          ? {
              ...state.room,
              you: {
                ...state.room.you,
                answer: {
                  questionId: message.payload.questionId,
                  optionId: message.payload.optionId,
                  lockedAt: message.payload.lockedAt,
                },
              },
            }
          : state.room,
      };

    case 'ANSWER_REJECTED':
      return {
        ...state,
        pendingAnswer: null,
        answerRejection: { code: message.payload.code, at: now },
      };

    case 'PLAYER_STATE':
      return withRoom(state, (room) => ({ ...room, you: message.payload.you }));

    case 'ERROR':
      return {
        ...state,
        error: {
          code: message.payload.code,
          at: now,
          ...(message.payload.params ? { params: message.payload.params } : {}),
        },
      };

    case 'SESSION_REVOKED':
      return {
        ...state,
        closedReason:
          message.payload.reason === 'ROOM_CLOSED' ? 'ROOM_CLOSED' : message.payload.reason,
        transport: 'CLOSED',
      };

    case 'SESSION_SUPERSEDED':
      return { ...state, closedReason: 'SUPERSEDED', transport: 'CLOSED' };

    case 'ACK':
    case 'PONG':
    case 'ROOM_CLOSING':
      return state;
  }
}
