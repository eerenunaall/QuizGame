import { meterView } from './venue';
import type {
  PhaseData,
  PublicPlayer,
  RoomView,
  RoundPublic,
  ScoreboardEntry,
  YouView,
} from '@quizparty/protocol';
import {
  coverRules,
  cutRules,
  doubleDownExcludedStakes,
  duelRules,
  maxRoundsFor,
  potRules,
} from './config';
import {
  activeStakeCap,
  canSabotage,
  coverLeft,
  doubleDownOffered,
  duelChallengersOf,
  duelAnswerOf,
  duelsLeft,
  jokerLockedOut,
  nextTokenStreak,
  pendingDuelInvites,
  potsLeft,
  roundLadder,
  sabotageKindsOffered,
  sabotageOpen,
  sabotagePicksOf,
} from './powers';
import { rankPlayers } from './rank';
import { exemptPlayerId, progressTicks } from './who-said-it';
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

/** Who has handed in a Who Said It statement, in join order. Only the fact, never the words. */
export function statementPlayerIds(state: Pick<RoomState, 'statements' | 'playerOrder'>): string[] {
  return state.playerOrder.filter((id) => state.statements[id] !== undefined);
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

/** Players the pick phases (RISK_PICK, SABOTAGE_PICK) wait for: in the game and online right now. */
export function prepEligibleIds(state: RoomState): string[] {
  const exempt = exemptPlayerId(state.game);
  return Object.entries(state.game?.players ?? {})
    .filter(([playerId, gp]) => {
      const player = state.players[playerId];
      return (
        playerId !== exempt &&
        !gp.removed &&
        player?.status === 'ACTIVE' &&
        player.connection === 'CONNECTED'
      );
    })
    .map(([playerId]) => playerId);
}

/**
 * Progress of the current pick phase, counts only (never who, ATTACK 27). RISK_PICK: players who
 * confirmed out of those online. SABOTAGE_PICK: sabotage confirmations out of everybody online, so the
 * number of players who hold a token is not disclosed either.
 */
export function prepCounts(state: RoomState): { committedCount: number; eligibleCount: number } {
  const game = state.game;
  const round = game?.round;
  if (!game || !round) return { committedCount: 0, eligibleCount: 0 };
  const entries = state.phase === 'SABOTAGE_PICK' ? sabotagePicksOf(round) : round.commitments;
  // RISK_PICK: a player with a Duel challenge still to answer is not done yet (ADR-0023). It is one more
  // tick that stays empty; nothing says why, or for whom.
  const committedCount = Object.keys(entries).filter(
    (playerId) =>
      state.players[playerId]?.status === 'ACTIVE' &&
      !game.players[playerId]?.removed &&
      (state.phase === 'SABOTAGE_PICK' || pendingDuelInvites(state, playerId).length === 0),
  ).length;
  return {
    committedCount,
    eligibleCount: Math.max(prepEligibleIds(state).length, committedCount),
  };
}

/** What RISK_PICK offers beyond stake and Double Down: config only, the same for everybody. */
function risksOffered(state: RoomState) {
  const cover = coverRules(state.config);
  const duel = duelRules(state.config);
  const pot = potRules(state.config);
  return {
    cover: cover.enabled,
    duel: duel.enabled ? { win: duel.win, bothRight: duel.bothRight } : null,
    pot: pot.enabled ? { ante: pot.ante, minPlayers: pot.minPlayers } : null,
  };
}

/** The sabotage menu of this round's SABOTAGE_PICK, and Cut's numbers when it is on it (config only). */
function sabotageMenu(state: RoomState) {
  const offered = sabotageKindsOffered(state);
  const cut = cutRules(state.config);
  return {
    offered,
    ...(offered.includes('CUT')
      ? { cutRule: { permille: cut.permille, maxPoints: cut.maxPoints } }
      : {}),
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
      return state.settings.mode === 'WHO_SAID_IT'
        ? { phase: 'LOBBY', statementPlayerIds: statementPlayerIds(state) }
        : { phase: 'LOBBY' };
    case 'COUNTDOWN':
      return { phase: 'COUNTDOWN' };
    case 'ROUND_INTRO':
      return { phase: 'ROUND_INTRO', round: roundPublic(state) };
    case 'FINAL':
      return { phase: 'FINAL', round: roundPublic(state) };
    case 'QUESTION_PREP': // legacy phase of a recovered room: shown as RISK_PICK
    case 'RISK_PICK': {
      const deckQuestion = game!.deck.questions[round!.questionId]!;
      const ladder = roundLadder(state.config, round!, game!.totalRounds);
      return {
        phase: 'RISK_PICK',
        round: roundPublic(state),
        category: { id: deckQuestion.category.id, label: deckQuestion.category.label },
        difficulty: deckQuestion.difficulty,
        riskLadder: ladder.rungs.map((rung) => ({
          ...rung,
          ...(coverRules(state.config).enabled
            ? { coverFee: Math.floor((rung.loss * coverRules(state.config).feePermille) / 1000) }
            : {}),
        })),
        stakeMandatory: ladder.mandatory,
        doubleDownEnabled: doubleDownOffered(state.config),
        doubleDownExcludedStakes: [...doubleDownExcludedStakes(state.config)],
        sabotageEnabled: sabotageOpen(state.config, round!),
        risks: risksOffered(state),
        ...prepCounts(state),
      };
    }
    case 'SABOTAGE_PICK': {
      const deckQuestion = game!.deck.questions[round!.questionId]!;
      return {
        phase: 'SABOTAGE_PICK',
        round: roundPublic(state),
        category: { id: deckQuestion.category.id, label: deckQuestion.category.label },
        difficulty: deckQuestion.difficulty,
        ...sabotageMenu(state),
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
          ...(option.playerId !== undefined ? { playerId: option.playerId } : {}),
        })),
        category: { id: question.category.id, label: question.category.label },
        difficulty: question.difficulty,
        questionStartedAt: round!.questionStartedAt!,
        answerOpensAt: round!.answerOpensAt!,
        answerDeadlineAt: round!.answerDeadlineAt!,
        answeredPlayerIds: progressTicks(state, Object.keys(round!.answers)),
      };
    }
    case 'LOCKED':
      return {
        phase: 'LOCKED',
        round: roundPublic(state),
        questionId: round!.question!.questionId,
        answeredPlayerIds: progressTicks(state, Object.keys(round!.answers)),
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
          ...(option.playerId !== undefined ? { playerId: option.playerId } : {}),
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

function duelInvitesView(state: RoomState, playerId: string) {
  const invites = duelChallengersOf(state, playerId).map((challengerId) => ({
    challengerId,
    answer: duelAnswerOf(state, playerId, challengerId),
  }));
  return invites.length > 0 ? { duelInvites: invites } : {};
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
          // ADR-0023, own counts only; absent for a game stored before them.
          ...(gamePlayer.powers.cover !== undefined ? { cover: coverLeft(gamePlayer.powers) } : {}),
          ...(gamePlayer.powers.duels !== undefined ? { duel: duelsLeft(gamePlayer.powers) } : {}),
          ...(gamePlayer.powers.pots !== undefined ? { pot: potsLeft(gamePlayer.powers) } : {}),
          ...(round && roundIsLive && activeStakeCap(gamePlayer.powers, round.index)
            ? { stakeCap: activeStakeCap(gamePlayer.powers, round.index) }
            : {}),
        }
      : null;
  const commitment = roundIsLive ? (round.commitments[playerId] ?? null) : null;
  const pick = roundIsLive ? (sabotagePicksOf(round)[playerId] ?? null) : null;
  const effects = roundIsLive ? (round.effects[playerId] ?? null) : null;
  // SHUFFLE/FOG need the options, which exist only from QUESTION on.
  const questionLive =
    state.phase !== 'QUESTION_PREP' &&
    state.phase !== 'RISK_PICK' &&
    state.phase !== 'SABOTAGE_PICK';

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
    // The player's own decisions only. A sabotage picked without a stake (RISK_PICK timed out or was
    // skipped) reports the round's default stake, which is what applies.
    commitment:
      commitment || pick
        ? {
            stake:
              commitment?.stake ?? roundLadder(state.config, round!, game!.totalRounds).defaultTier,
            doubleDown: commitment?.doubleDown ?? false,
            sabotage: pick?.sabotage
              ? { targetId: pick.sabotage.targetId, effect: pick.sabotage.effect }
              : null,
            ...(commitment?.cover ? { cover: true } : {}),
            ...(commitment?.pot ? { pot: true } : {}),
            ...(commitment?.duel ? { duel: { targetId: commitment.duel.targetId } } : {}),
          }
        : null,
    // Challenges aimed at this player, private to them (never for the author of a Who Said It round).
    ...(roundIsLive && exemptPlayerId(game ?? null) !== playerId
      ? duelInvitesView(state, playerId)
      : {}),
    sabotage:
      roundIsLive && (state.phase === 'SABOTAGE_PICK' || pick)
        ? { ready: canSabotage(state, playerId), decided: pick !== null }
        : undefined,
    fiftyFifty:
      roundIsLive && round.fiftyFiftyUsers[playerId] && round.fiftyFifty
        ? { keep: [...round.fiftyFifty.keep] }
        : null,
    // What hit the player is known once the options exist, i.e. after the pick phases.
    effects:
      effects && questionLive
        ? {
            jamMs: effects.jamMs,
            order: effects.order ? [...effects.order] : null,
            fogOptionId: effects.fogOptionId,
            fogMs: effects.fogMs,
            ...(effects.blindClock ? { blindClock: true } : {}),
          }
        : null,
    hits: effects && questionLive ? effects.hits.map((hit) => ({ ...hit })) : [],
    reducedEffects: player.reducedEffects,
    // Only ever the player's own words, and only to that player's own phone.
    myStatement:
      state.phase === 'LOBBY' || state.phase === 'WAITING'
        ? (state.statements[playerId] ?? null)
        : null,
    // Known to the server from the moment the round is planned; told to that one player only.
    authorOfRound: roundIsLive && exemptPlayerId(game ?? null) === playerId,
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
      contentTitle: state.settings.contentTitle,
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
    // Venue mode: the table's meter is public room information; nothing else of a venue is (ADR-0024).
    ...(state.venue ? { venue: meterView(state.venue, now) } : {}),
  };
}
