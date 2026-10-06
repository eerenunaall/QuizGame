import type {
  PhaseData,
  PublicPlayer,
  RoomView,
  RoundPublic,
  ScoreboardEntry,
  YouView,
} from '@quizparty/protocol';
import { rankPlayers } from './rank';
import type { Actor, RoomState } from './types';

/**
 * Projection of engine state into what clients may see. Everything here is an allow-list: fields
 * are copied one by one, nothing is spread from state. The private parts (deck, correct option,
 * outcomes before reveal, PRNG inputs) are structurally unreachable from these functions' outputs,
 * and the zod `strictObject` schemas in @quizparty/protocol reject anything extra (ADR-0008).
 */
export type Viewer = { role: 'DISPLAY' } | { role: 'PLAYER'; playerId: string };

export function activePlayers(state: RoomState) {
  return state.playerOrder
    .map((playerId) => state.players[playerId])
    .filter(
      (player): player is NonNullable<typeof player> =>
        player !== undefined && player.status === 'ACTIVE',
    );
}

export function toPublicPlayer(state: RoomState, playerId: string): PublicPlayer {
  const player = state.players[playerId]!;
  return {
    playerId: player.playerId,
    nickname: player.nickname,
    avatarId: player.avatarId,
    colorSlot: player.colorSlot,
    joinIndex: player.joinIndex,
    connection: player.connection,
    ready: player.ready,
    isLeader: state.leaderPlayerId === player.playerId,
  };
}

export function isHostActor(state: RoomState, actor: Actor): boolean {
  if (actor.role === 'DISPLAY') return actor.sessionId === state.display.sessionId;
  const player = state.players[actor.playerId];
  return (
    player !== undefined &&
    player.status === 'ACTIVE' &&
    player.sessionId === actor.sessionId &&
    state.leaderPlayerId === actor.playerId
  );
}

function roundPublic(state: RoomState): RoundPublic {
  const round = state.game!.round!;
  return {
    index: round.index,
    total: state.game!.totalRounds,
    kind: round.kind,
    isFinal: round.isFinal,
    basePoints: round.basePoints,
    speedMax: round.speedMax,
    answerMs: round.answerMs,
  };
}

export function scoreboard(state: RoomState): ScoreboardEntry[] {
  const game = state.game;
  if (!game) return [];
  const entries = Object.entries(game.players)
    .filter(([, gp]) => !gp.removed)
    .map(([playerId, gp]) => ({
      playerId,
      score: gp.score,
      correctCount: gp.correctCount,
      totalRemainingMs: gp.totalRemainingMs,
      joinIndex: state.players[playerId]?.joinIndex ?? Number.MAX_SAFE_INTEGER,
      streak: gp.streak,
    }));
  const streaks = new Map(entries.map((entry) => [entry.playerId, entry.streak]));
  return rankPlayers(entries).map((entry) => ({
    playerId: entry.playerId,
    score: entry.score,
    rank: entry.rank,
    streak: streaks.get(entry.playerId) ?? 0,
  }));
}

const orderedIds = (state: RoomState, ids: Iterable<string>): string[] => {
  const set = new Set(ids);
  return state.playerOrder.filter((id) => set.has(id));
};

export function phaseDataFor(state: RoomState): PhaseData {
  const game = state.game;
  const round = game?.round ?? null;
  switch (state.phase) {
    case 'WAITING':
      return { phase: 'WAITING' };
    case 'LOBBY':
      return { phase: 'LOBBY' };
    case 'COUNTDOWN':
      return { phase: 'COUNTDOWN' };
    case 'ROUND_INTRO':
      return { phase: 'ROUND_INTRO', round: roundPublic(state) };
    case 'FINAL':
      return { phase: 'FINAL', round: roundPublic(state) };
    case 'QUESTION_PREP': {
      const deckQuestion = game!.deck.questions[round!.questionId]!;
      return {
        phase: 'QUESTION_PREP',
        round: roundPublic(state),
        category: { id: deckQuestion.category.id, label: deckQuestion.category.label },
        difficulty: deckQuestion.difficulty,
        riskLadder: [],
        doubleDownEnabled: false,
        sabotageEnabled: false,
        committedCount: 0,
      };
    }
    case 'QUESTION': {
      const question = round!.question!;
      return {
        phase: 'QUESTION',
        round: roundPublic(state),
        questionId: question.questionId,
        text: question.text,
        category: { id: question.category.id, label: question.category.label },
        difficulty: question.difficulty,
      };
    }
    case 'ANSWERING': {
      const question = round!.question!;
      return {
        phase: 'ANSWERING',
        round: roundPublic(state),
        questionId: question.questionId,
        text: question.text,
        options: question.options.map((option) => ({
          optionId: option.optionId,
          text: option.text,
        })),
        category: { id: question.category.id, label: question.category.label },
        difficulty: question.difficulty,
        questionStartedAt: round!.questionStartedAt!,
        answerOpensAt: round!.answerOpensAt!,
        answerDeadlineAt: round!.answerDeadlineAt!,
        answeredPlayerIds: orderedIds(state, Object.keys(round!.answers)),
      };
    }
    case 'LOCKED':
      return {
        phase: 'LOCKED',
        round: roundPublic(state),
        questionId: round!.question!.questionId,
        answeredPlayerIds: orderedIds(state, Object.keys(round!.answers)),
      };
    case 'REVEAL': {
      const question = round!.question!;
      const outcome = round!.outcome!;
      return {
        phase: 'REVEAL',
        round: roundPublic(state),
        questionId: question.questionId,
        text: question.text,
        options: question.options.map((option) => ({
          optionId: option.optionId,
          text: option.text,
        })),
        correctOptionId: question.correctOptionId,
        explanation: question.explanation,
        distribution: question.options.map((option) => ({
          optionId: option.optionId,
          count: outcome.distribution[option.optionId] ?? 0,
        })),
        results: orderedIds(state, Object.keys(outcome.players)).map((playerId) => {
          const result = outcome.players[playerId]!;
          return { playerId, outcome: result.result, optionId: result.optionId };
        }),
      };
    }
    case 'POWER_RESOLUTION':
      return { phase: 'POWER_RESOLUTION', round: roundPublic(state), items: [] };
    case 'SCORE_UPDATE': {
      const update = round!.scoreUpdate!;
      return {
        phase: 'SCORE_UPDATE',
        round: roundPublic(state),
        deltas: update.deltas.map((delta) => ({
          ...delta,
          components: delta.components.map((c) => ({ ...c })),
        })),
        scoreboard: update.scoreboard.map((entry) => ({ ...entry })),
      };
    }
    case 'MICRO_INTERMISSION':
    case 'NEXT_ROUND':
      return {
        phase: 'MICRO_INTERMISSION',
        next: game?.upcoming ? { index: game.upcoming.index, kind: game.upcoming.kind } : null,
      };
    case 'RESULTS': {
      const results = game!.results!;
      return {
        phase: 'RESULTS',
        ranking: results.ranking.map((entry) => ({ ...entry })),
        awards: results.awards.map((award) => ({ ...award })),
      };
    }
    case 'ROOM_CLOSED':
      return { phase: 'ROOM_CLOSED', reason: state.closed?.reason ?? 'HOST_ENDED' };
  }
}

export function youView(state: RoomState, playerId: string): YouView | null {
  const player = state.players[playerId];
  if (!player || player.status !== 'ACTIVE') return null;
  const round = state.game?.round;
  const answerPhases = ['ANSWERING', 'LOCKED', 'REVEAL', 'POWER_RESOLUTION', 'SCORE_UPDATE'];
  const record = round && answerPhases.includes(state.phase) ? round.answers[playerId] : undefined;
  return {
    playerId,
    isLeader: state.leaderPlayerId === playerId,
    canHost: state.leaderPlayerId === playerId,
    answer:
      record && round?.question
        ? {
            questionId: round.question.questionId,
            optionId: record.optionId,
            lockedAt: (round.answerOpensAt ?? 0) + record.offsetMs,
          }
        : null,
  };
}

export function roomView(state: RoomState, viewer: Viewer, now: number): RoomView {
  const game = state.game;
  return {
    roomId: state.roomId,
    code: state.code,
    stateVersion: state.version,
    serverTime: now,
    phase: state.phase === 'NEXT_ROUND' ? 'MICRO_INTERMISSION' : state.phase,
    phaseEnteredAt: state.phaseEnteredAt,
    phaseDeadlineAt: state.phaseDeadlineAt,
    tier: state.tier,
    contentLanguage: state.contentLanguage,
    maxPlayers: state.config.maxPlayers,
    settings: {
      mode: state.settings.mode,
      rounds: state.settings.rounds,
      categories: state.settings.categories === 'ALL' ? 'ALL' : [...state.settings.categories],
    },
    displayConnected: state.display.connected,
    awaitingDisplay: state.awaitingDisplay,
    players: activePlayers(state).map((player) => toPublicPlayer(state, player.playerId)),
    game: game
      ? {
          gameId: game.gameId,
          totalRounds: game.totalRounds,
          roundIndex: game.roundIndex,
          scoreboard: scoreboard(state),
        }
      : null,
    phaseData: phaseDataFor(state),
    you: viewer.role === 'PLAYER' ? youView(state, viewer.playerId) : null,
  };
}
