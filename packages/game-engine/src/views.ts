import type {
  PhaseData,
  PublicPlayer,
  RoomView,
  RoundPublic,
  ScoreboardEntry,
  YouView,
} from '@quizparty/protocol';
import { maxRoundsFor } from './config';
import {
  doubleDownOffered,
  jokerLockedOut,
  nextTokenStreak,
  roundLadder,
  sabotageOpen,
} from './powers';
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
  const game = state.game!;
  const round = game.round!;
  return {
    index: round.index,
    total: game.totalRounds,
    kind: round.kind,
    isFinal: round.isFinal,
    finalStage: round.isFinal
      ? {
          position: round.index - (game.totalRounds - game.finalLength) + 1,
          length: game.finalLength,
        }
      : null,
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

/** Players QUESTION_PREP waits for: in the game and online right now. */
export function prepEligibleIds(state: RoomState): string[] {
  return Object.entries(state.game?.players ?? {})
    .filter(([playerId, gp]) => {
      const player = state.players[playerId];
      return !gp.removed && player?.status === 'ACTIVE' && player.connection === 'CONNECTED';
    })
    .map(([playerId]) => playerId);
}

export function prepCounts(state: RoomState): { committedCount: number; eligibleCount: number } {
  const game = state.game;
  const round = game?.round;
  if (!game || !round) return { committedCount: 0, eligibleCount: 0 };
  const committedCount = Object.keys(round.commitments).filter(
    (playerId) => state.players[playerId]?.status === 'ACTIVE' && !game.players[playerId]?.removed,
  ).length;
  return {
    committedCount,
    eligibleCount: Math.max(prepEligibleIds(state).length, committedCount),
  };
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
      const ladder = roundLadder(state.config, round!, game!.totalRounds);
      return {
        phase: 'QUESTION_PREP',
        round: roundPublic(state),
        category: { id: deckQuestion.category.id, label: deckQuestion.category.label },
        difficulty: deckQuestion.difficulty,
        riskLadder: ladder.rungs.map((rung) => ({ ...rung })),
        stakeMandatory: ladder.mandatory,
        doubleDownEnabled: doubleDownOffered(state.config),
        sabotageEnabled: sabotageOpen(state.config, round!),
        ...prepCounts(state),
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
      return {
        phase: 'POWER_RESOLUTION',
        round: roundPublic(state),
        items: round!.powerItems.map((item) => ({ ...item })),
      };
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
  const game = state.game;
  const round = game?.round;
  const gamePlayer = game?.players[playerId];
  const answerPhases = ['ANSWERING', 'LOCKED', 'REVEAL', 'POWER_RESOLUTION', 'SCORE_UPDATE'];
  const record = round && answerPhases.includes(state.phase) ? round.answers[playerId] : undefined;

  // Power state is private and only exists while a game runs.
  const inRound = round !== undefined && round !== null && gamePlayer !== undefined;
  const roundIsLive = inRound && state.phase !== 'COUNTDOWN' && state.phase !== 'ROUND_INTRO';
  const powers =
    game && gamePlayer && !gamePlayer.removed
      ? {
          fiftyFifty: gamePlayer.powers.fiftyFifty,
          doubleDown: gamePlayer.powers.doubleDown,
          shield: gamePlayer.powers.shield,
          sabotageTokens: gamePlayer.powers.tokens,
          nextTokenAtStreak: nextTokenStreak(state.config, gamePlayer.streak),
          lockedJoker:
            round && roundIsLive
              ? ((['FIFTY_FIFTY', 'DOUBLE_DOWN'] as const).find((joker) =>
                  jokerLockedOut(gamePlayer.powers, joker, round.index),
                ) ?? null)
              : null,
        }
      : null;
  const commitment = roundIsLive ? (round.commitments[playerId] ?? null) : null;
  const effects = roundIsLive ? (round.effects[playerId] ?? null) : null;
  const questionLive = state.phase !== 'QUESTION_PREP';

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
    powers,
    commitment: commitment
      ? {
          stake: commitment.stake,
          doubleDown: commitment.doubleDown,
          sabotage: commitment.sabotage
            ? { targetId: commitment.sabotage.targetId, effect: commitment.sabotage.effect }
            : null,
        }
      : null,
    fiftyFifty:
      roundIsLive && round.fiftyFiftyUsers[playerId] && round.fiftyFifty
        ? { keep: [...round.fiftyFifty.keep] }
        : null,
    // What hit the player is known once the options exist, i.e. after QUESTION_PREP.
    effects:
      effects && questionLive
        ? {
            jamMs: effects.jamMs,
            order: effects.order ? [...effects.order] : null,
            fogOptionId: effects.fogOptionId,
            fogMs: effects.fogMs,
          }
        : null,
    hits: effects && questionLive ? effects.hits.map((hit) => ({ ...hit })) : [],
    reducedEffects: player.reducedEffects,
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
    limits: { maxRounds: maxRoundsFor(state.config, state.tier) },
    settings: {
      mode: state.settings.mode,
      rounds: state.settings.rounds,
      difficulty: state.settings.difficulty,
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
