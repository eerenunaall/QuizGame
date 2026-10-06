import type { PhaseData, PublicPlayer, RoomView, ServerMessage } from '@quizparty/protocol';
import type { ClientState } from './types';

const byJoinOrder = (a: PublicPlayer, b: PublicPlayer): number => a.joinIndex - b.joinIndex;

function withRoom(state: ClientState, change: (room: RoomView) => RoomView): ClientState {
  return state.room ? { ...state, room: change(state.room) } : state;
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
      return {
        ...state,
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
      return withRoom(state, (room) => ({ ...room, tier: message.payload.tier }));

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
