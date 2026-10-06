import { produce, type Draft } from 'immer';
import { Rng, clamp, rngStateFromSeed } from '@quizparty/shared';
import type { CloseReason, ErrorCode, ServerEvent, Tier } from '@quizparty/protocol';
import {
  finalStageLength,
  ladderKindFor,
  maxRoundsFor,
  presetOffset,
  resolveGameConfig,
  type GameConfig,
} from './config';
import { deckSize, selectQuestionId } from './deck';
import { LEVEL_MAX, LEVEL_MIN, chooseRoundKind, direct } from './director';
import {
  buildPowerItems,
  checkCommit,
  chooseFiftyFifty,
  doubleDownOffered,
  earnToken,
  jamFor,
  jokerLockedOut,
  newLedger,
  resolveSabotage,
  roundLadder,
  sabotageOpen,
} from './powers';
import { rankPlayers } from './rank';
import { computeScore } from './scoring';
import { isInGamePhase } from './timers';
import type {
  Actor,
  Audience,
  CommandResult,
  DeckRequest,
  Effect,
  EngineCommand,
  EngineInput,
  Player,
  PresentedOption,
  PresentedQuestion,
  ReduceResult,
  RoomState,
  ResultsRecord,
  RoundOutcome,
  UpcomingRound,
} from './types';
import { isHostActor, phaseDataFor, prepCounts, toPublicPlayer, youView } from './views';

type Room = Draft<RoomState>;

interface Ctx {
  input: EngineInput;
  effects: Effect[];
  result: CommandResult;
  rng: () => Rng;
}

const OPAQUE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export interface CreateRoomParams {
  roomId: string;
  code: string;
  displaySessionId: string;
  now: number;
  config?: GameConfig;
  tier?: Tier;
  hostAccountId?: string | null;
  contentLanguage?: 'tr' | 'en';
}

export function createRoom(params: CreateRoomParams): RoomState {
  const config = params.config ?? resolveGameConfig();
  const tier = params.tier ?? 'FREE';
  const rounds = Math.min(config.defaultRounds, maxRoundsFor(config, tier));
  return {
    schemaVersion: 1,
    roomId: params.roomId,
    code: params.code,
    version: 0,
    createdAt: params.now,
    lastActivityAt: params.now,
    phase: 'WAITING',
    phaseEnteredAt: params.now,
    phaseDeadlineAt: null,
    tier,
    hostAccountId: params.hostAccountId ?? null,
    contentLanguage: params.contentLanguage ?? 'tr',
    settings: { mode: 'CLASSIC', rounds, difficulty: 'MEDIUM', categories: 'ALL' },
    config,
    display: { sessionId: params.displaySessionId, connected: false, disconnectedAt: params.now },
    awaitingDisplay: false,
    leaderPlayerId: null,
    leaderLostAt: null,
    nextJoinIndex: 0,
    players: {},
    playerOrder: [],
    game: null,
    closed: null,
  };
}

/**
 * The single place game state changes. Pure: the result depends only on `(state, input)`;
 * time and randomness arrive inside the input. Inputs that change state are what the server
 * appends to the durable log, so replaying them reproduces the state exactly (ADR-0006).
 */
export function reduce(state: RoomState, input: EngineInput): ReduceResult {
  if (state.phase === 'ROOM_CLOSED') {
    return { state, effects: [], result: { ok: false, code: 'ROOM_CLOSED' }, changed: false };
  }
  const ctx: Ctx = {
    input,
    effects: [],
    result: { ok: true },
    rng: lazyRng(input.entropy),
  };
  const next = produce(state, (draft) => {
    dispatch(draft, ctx);
  });
  if (next === state) {
    return { state, effects: ctx.effects, result: ctx.result, changed: false };
  }
  const bumped: RoomState = { ...next, version: state.version + 1 };
  if (bumped.phase !== state.phase) {
    ctx.effects.push(
      emitEffect(
        { to: 'ALL' },
        {
          type: 'PHASE_ENTERED',
          payload: {
            phaseEnteredAt: bumped.phaseEnteredAt,
            phaseDeadlineAt: bumped.phaseDeadlineAt,
            data: phaseDataFor(bumped),
          },
        },
      ),
    );
  }
  return { state: bumped, effects: ctx.effects, result: ctx.result, changed: true };
}

function lazyRng(entropy: string): () => Rng {
  let rng: Rng | null = null;
  return () => (rng ??= new Rng(rngStateFromSeed(entropy)));
}

function emitEffect(audience: Audience, event: ServerEvent): Effect {
  return { kind: 'emit', audience, event };
}

function emit(ctx: Ctx, audience: Audience, event: ServerEvent): void {
  ctx.effects.push(emitEffect(audience, event));
}

function reject(ctx: Ctx, code: ErrorCode): void {
  ctx.result = { ok: false, code };
}

function dispatch(d: Room, ctx: Ctx): void {
  const input = ctx.input;
  switch (input.kind) {
    case 'DISPLAY_CONNECTION':
      return onDisplayConnection(d, ctx, input.at, input.connected);
    case 'PLAYER_JOIN':
      return onPlayerJoin(d, ctx, input.at, input.player);
    case 'PLAYER_CONNECTION':
      return onPlayerConnection(d, ctx, input.at, input.playerId, input.connected);
    case 'COMMAND':
      return onCommand(
        d,
        ctx,
        input.at,
        input.actor,
        input.command,
        input.messageId,
        input.nicknameKey,
      );
    case 'BEGIN_GAME':
      return onBeginGame(d, ctx, input);
    case 'TICK':
      return onTick(d, ctx, input.at);
    case 'ENTITLEMENT':
      return onEntitlement(d, ctx, input.tier, input.hostAccountId);
    case 'RECOVER':
      return onRecover(d, ctx, input.at, input.outageMs);
    case 'CLOSE':
      return closeRoom(d, ctx, input.at, input.reason);
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function enterPhase(d: Room, phase: Room['phase'], at: number, durationMs: number | null): void {
  d.phase = phase;
  d.phaseEnteredAt = at;
  d.phaseDeadlineAt = durationMs === null ? null : at + durationMs;
}

function activePlayerList(d: Room): Draft<Player>[] {
  return d.playerOrder
    .map((id) => d.players[id])
    .filter((p): p is Draft<Player> => p !== undefined && p.status === 'ACTIVE');
}

function pickLeader(d: Room, excludePlayerId: string | null): string | null {
  const candidates = activePlayerList(d).filter((p) => p.playerId !== excludePlayerId);
  const connected = candidates.filter((p) => p.connection === 'CONNECTED');
  const pool = connected.length > 0 ? connected : candidates;
  const best = pool
    .slice()
    .sort((a, b) => a.joinIndex - b.joinIndex || a.playerId.localeCompare(b.playerId))[0];
  return best?.playerId ?? null;
}

function setLeader(d: Room, ctx: Ctx, playerId: string | null): void {
  d.leaderPlayerId = playerId;
  const leader = playerId ? d.players[playerId] : undefined;
  d.leaderLostAt =
    leader && leader.connection === 'DISCONNECTED' ? (leader.disconnectedAt ?? ctx.input.at) : null;
  emit(ctx, { to: 'ALL' }, { type: 'LEADER_CHANGED', payload: { playerId } });
  for (const player of activePlayerList(d)) {
    const you = youView(d, player.playerId);
    if (you)
      emit(
        ctx,
        { to: 'PLAYER', playerId: player.playerId },
        { type: 'PLAYER_STATE', payload: { you } },
      );
  }
}

function removePlayer(
  d: Room,
  ctx: Ctx,
  playerId: string,
  reason: 'LEFT' | 'KICKED',
  at: number,
): void {
  const player = d.players[playerId];
  if (!player || player.status !== 'ACTIVE') return;
  player.status = reason;
  player.ready = false;
  d.playerOrder = d.playerOrder.filter((id) => id !== playerId);
  if (d.game?.players[playerId]) d.game.players[playerId].removed = true;
  emit(ctx, { to: 'ALL' }, { type: 'PLAYER_LEFT', payload: { playerId, reason } });
  ctx.effects.push({ kind: 'kick', playerId, reason });

  if (d.leaderPlayerId === playerId) setLeader(d, ctx, pickLeader(d, playerId));

  const remaining = activePlayerList(d);
  if (remaining.length === 0) {
    if (d.phase === 'LOBBY') {
      d.phase = 'WAITING';
      d.phaseEnteredAt = at;
    } else if (isInGamePhase(d.phase)) {
      closeRoom(d, ctx, at, 'ABANDONED');
    }
    return;
  }
  if (d.phase === 'ANSWERING') maybeEarlyLock(d, ctx, at);
}

function closeRoom(d: Room, ctx: Ctx, at: number, reason: CloseReason): void {
  if (d.phase === 'ROOM_CLOSED') return;
  d.closed = { reason, at };
  d.phase = 'ROOM_CLOSED';
  d.phaseEnteredAt = at;
  d.phaseDeadlineAt = null;
  ctx.effects.push({ kind: 'closeRoom', reason });
  ctx.effects.push({ kind: 'telemetry', name: 'room_closed', props: { reason } });
}

function touch(d: Room, at: number): void {
  d.lastActivityAt = at;
}

// ───────────────────────────── connections & joining ─────────────────────────────

function onDisplayConnection(d: Room, ctx: Ctx, at: number, connected: boolean): void {
  if (connected) {
    if (d.display.connected && d.display.disconnectedAt === null) return;
    d.display.connected = true;
    d.display.disconnectedAt = null;
    if (d.awaitingDisplay) {
      d.awaitingDisplay = false;
      d.phaseDeadlineAt = at + 500; // resume the held round boundary
    }
    touch(d, at);
  } else {
    if (!d.display.connected && d.display.disconnectedAt !== null) return;
    d.display.connected = false;
    d.display.disconnectedAt = at;
  }
  emitDisplayStatus(d, ctx);
}

function emitDisplayStatus(d: Room, ctx: Ctx): void {
  emit(
    ctx,
    { to: 'PLAYERS' },
    {
      type: 'DISPLAY_STATUS',
      payload: { connected: d.display.connected, awaitingDisplay: d.awaitingDisplay },
    },
  );
}

function onPlayerJoin(
  d: Room,
  ctx: Ctx,
  at: number,
  joining: Extract<EngineInput, { kind: 'PLAYER_JOIN' }>['player'],
): void {
  if (d.phase !== 'WAITING' && d.phase !== 'LOBBY') return reject(ctx, 'GAME_IN_PROGRESS');
  const active = activePlayerList(d);
  if (active.length >= d.config.maxPlayers) return reject(ctx, 'ROOM_FULL');
  if (d.players[joining.playerId]) return reject(ctx, 'ALREADY_JOINED');
  if (active.some((p) => p.nicknameKey === joining.nicknameKey))
    return reject(ctx, 'NICKNAME_TAKEN');

  const used = new Set(active.map((p) => p.colorSlot));
  let colorSlot = 1;
  while (used.has(colorSlot)) colorSlot += 1;

  d.players[joining.playerId] = {
    playerId: joining.playerId,
    sessionId: joining.sessionId,
    nickname: joining.nickname,
    nicknameKey: joining.nicknameKey,
    avatarId: joining.avatarId,
    colorSlot,
    joinIndex: d.nextJoinIndex,
    ready: false,
    connection: 'CONNECTED',
    disconnectedAt: null,
    status: 'ACTIVE',
    reducedEffects: false,
  };
  d.nextJoinIndex += 1;
  d.playerOrder.push(joining.playerId);
  if (d.phase === 'WAITING') {
    d.phase = 'LOBBY';
    d.phaseEnteredAt = at;
  }
  touch(d, at);
  // The first player becomes leader *before* the join is announced, so PLAYER_JOINED is consistent.
  const becomesLeader = d.leaderPlayerId === null;
  if (becomesLeader) {
    d.leaderPlayerId = joining.playerId;
    d.leaderLostAt = null;
  }
  emit(
    ctx,
    { to: 'ALL' },
    {
      type: 'PLAYER_JOINED',
      payload: { player: toPublicPlayer(d, joining.playerId) },
    },
  );
  ctx.effects.push({
    kind: 'telemetry',
    name: 'player_joined',
    props: { players: active.length + 1 },
  });
  if (becomesLeader) setLeader(d, ctx, joining.playerId);
}

function onPlayerConnection(
  d: Room,
  ctx: Ctx,
  at: number,
  playerId: string,
  connected: boolean,
): void {
  const player = d.players[playerId];
  if (!player || player.status !== 'ACTIVE') return;
  if (connected) {
    if (player.connection === 'CONNECTED') return;
    player.connection = 'CONNECTED';
    player.disconnectedAt = null;
    if (d.leaderPlayerId === playerId) d.leaderLostAt = null;
    touch(d, at);
  } else {
    if (player.connection === 'DISCONNECTED') return;
    player.connection = 'DISCONNECTED';
    player.disconnectedAt = at;
    if (d.leaderPlayerId === playerId) d.leaderLostAt = at;
  }
  emit(
    ctx,
    { to: 'ALL' },
    {
      type: 'PLAYER_STATUS',
      payload: { playerId, connection: player.connection, ready: player.ready },
    },
  );
}

// ───────────────────────────── commands ─────────────────────────────

function onCommand(
  d: Room,
  ctx: Ctx,
  at: number,
  actor: Actor,
  command: EngineCommand,
  messageId: string,
  nicknameKey: string | undefined,
): void {
  if (actor.role === 'DISPLAY') {
    if (actor.sessionId !== d.display.sessionId) return reject(ctx, 'FORBIDDEN');
  } else {
    const player = d.players[actor.playerId];
    if (!player || player.status !== 'ACTIVE' || player.sessionId !== actor.sessionId) {
      return reject(ctx, 'FORBIDDEN');
    }
  }
  const isHost = isHostActor(d, actor);
  const playerId = actor.role === 'PLAYER' ? actor.playerId : null;

  switch (command.type) {
    case 'READY': {
      if (!playerId) return reject(ctx, 'FORBIDDEN');
      if (d.phase !== 'LOBBY') return reject(ctx, 'INVALID_STATE');
      const player = d.players[playerId]!;
      if (player.ready === command.payload.ready) return;
      player.ready = command.payload.ready;
      touch(d, at);
      emit(
        ctx,
        { to: 'ALL' },
        {
          type: 'PLAYER_STATUS',
          payload: { playerId, connection: player.connection, ready: player.ready },
        },
      );
      return;
    }
    case 'SET_NICKNAME': {
      if (!playerId) return reject(ctx, 'FORBIDDEN');
      if (d.phase !== 'LOBBY' && d.phase !== 'WAITING') return reject(ctx, 'INVALID_STATE');
      if (!nicknameKey) return reject(ctx, 'NICKNAME_INVALID');
      if (
        activePlayerList(d).some((p) => p.playerId !== playerId && p.nicknameKey === nicknameKey)
      ) {
        return reject(ctx, 'NICKNAME_TAKEN');
      }
      const player = d.players[playerId]!;
      player.nickname = command.payload.nickname;
      player.nicknameKey = nicknameKey;
      touch(d, at);
      emit(
        ctx,
        { to: 'ALL' },
        { type: 'NICKNAME_CHANGED', payload: { playerId, nickname: player.nickname } },
      );
      return;
    }
    case 'SUBMIT_ANSWER':
      if (!playerId) return reject(ctx, 'FORBIDDEN');
      return submitAnswer(
        d,
        ctx,
        at,
        playerId,
        messageId,
        command.payload.questionId,
        command.payload.optionId,
      );
    case 'COMMIT_PREP':
      if (!playerId) return reject(ctx, 'FORBIDDEN');
      return commitPrep(d, ctx, at, playerId, command.payload);
    case 'USE_FIFTY_FIFTY':
      if (!playerId) return reject(ctx, 'FORBIDDEN');
      return useFiftyFifty(d, ctx, at, playerId);
    case 'SET_PREFERENCES': {
      if (!playerId) return reject(ctx, 'FORBIDDEN');
      const player = d.players[playerId]!;
      if (player.reducedEffects === command.payload.reducedEffects) return;
      player.reducedEffects = command.payload.reducedEffects;
      touch(d, at);
      return emitPlayerState(d, ctx, playerId);
    }
    case 'LEAVE_ROOM': {
      if (!playerId) return reject(ctx, 'FORBIDDEN');
      touch(d, at);
      return removePlayer(d, ctx, playerId, 'LEFT', at);
    }
    case 'SET_SETTINGS': {
      if (!isHost) return reject(ctx, 'NOT_HOST');
      if (d.phase !== 'LOBBY' && d.phase !== 'WAITING' && d.phase !== 'RESULTS')
        return reject(ctx, 'INVALID_STATE');
      const maxRounds = maxRoundsFor(d.config, d.tier);
      const rounds =
        command.payload.rounds === undefined
          ? d.settings.rounds
          : Math.min(command.payload.rounds, maxRounds);
      const categories = command.payload.categories ?? d.settings.categories;
      d.settings.rounds = rounds;
      d.settings.difficulty = command.payload.difficulty ?? d.settings.difficulty;
      d.settings.categories = categories === 'ALL' ? 'ALL' : [...categories];
      touch(d, at);
      emit(
        ctx,
        { to: 'ALL' },
        { type: 'SETTINGS_CHANGED', payload: { settings: structuredSettings(d) } },
      );
      return;
    }
    case 'KICK_PLAYER': {
      if (!isHost) return reject(ctx, 'NOT_HOST');
      const target = d.players[command.payload.playerId];
      if (!target || target.status !== 'ACTIVE') return reject(ctx, 'PLAYER_NOT_FOUND');
      if (playerId !== null && target.playerId === playerId) return reject(ctx, 'INVALID_STATE');
      touch(d, at);
      return removePlayer(d, ctx, target.playerId, 'KICKED', at);
    }
    case 'TRANSFER_LEADER': {
      if (!isHost) return reject(ctx, 'NOT_HOST');
      const target = d.players[command.payload.playerId];
      if (!target || target.status !== 'ACTIVE') return reject(ctx, 'PLAYER_NOT_FOUND');
      if (d.leaderPlayerId === target.playerId) return;
      touch(d, at);
      return setLeader(d, ctx, target.playerId);
    }
    case 'START_GAME': {
      if (!isHost) return reject(ctx, 'NOT_HOST');
      if (d.phase !== 'LOBBY') return reject(ctx, 'INVALID_STATE');
      return requestDeck(d, ctx, 'START', actor);
    }
    case 'REMATCH': {
      if (!isHost) return reject(ctx, 'NOT_HOST');
      if (d.phase !== 'RESULTS') return reject(ctx, 'INVALID_STATE');
      return requestDeck(d, ctx, 'REMATCH', actor);
    }
    case 'BACK_TO_LOBBY': {
      if (!isHost) return reject(ctx, 'NOT_HOST');
      if (d.phase !== 'RESULTS') return reject(ctx, 'INVALID_STATE');
      d.game = null;
      for (const player of activePlayerList(d)) player.ready = false;
      enterPhase(d, 'LOBBY', at, null);
      touch(d, at);
      return;
    }
    case 'END_ROOM': {
      if (!isHost) return reject(ctx, 'NOT_HOST');
      return closeRoom(d, ctx, at, 'HOST_ENDED');
    }
  }
}

function structuredSettings(d: Room) {
  return {
    mode: d.settings.mode,
    rounds: d.settings.rounds,
    difficulty: d.settings.difficulty,
    categories: d.settings.categories === 'ALL' ? ('ALL' as const) : [...d.settings.categories],
  };
}

function connectedPlayerCount(d: Room): number {
  return activePlayerList(d).filter((p) => p.connection === 'CONNECTED').length;
}

function requestDeck(d: Room, ctx: Ctx, purpose: 'START' | 'REMATCH', actor: Actor): void {
  if (connectedPlayerCount(d) < d.config.minPlayersToStart)
    return reject(ctx, 'NOT_ENOUGH_PLAYERS');
  const maxRounds = maxRoundsFor(d.config, d.tier);
  const request: DeckRequest = {
    rounds: Math.min(d.settings.rounds, maxRounds),
    categories: d.settings.categories === 'ALL' ? 'ALL' : [...d.settings.categories],
    language: d.contentLanguage,
    tier: d.tier,
    hostAccountId: d.hostAccountId,
    playerCount: connectedPlayerCount(d),
  };
  ctx.effects.push({ kind: 'needDeck', purpose, request, requestedBy: actor });
}

// ───────────────────────────── game start ─────────────────────────────

function onBeginGame(d: Room, ctx: Ctx, input: Extract<EngineInput, { kind: 'BEGIN_GAME' }>): void {
  const { at, requestedBy, purpose } = input;
  const expectedPhase = purpose === 'START' ? 'LOBBY' : 'RESULTS';
  if (d.phase !== expectedPhase) return reject(ctx, 'INVALID_STATE');
  if (!isHostActor(d, requestedBy)) return reject(ctx, 'NOT_HOST');
  if (connectedPlayerCount(d) < d.config.minPlayersToStart)
    return reject(ctx, 'NOT_ENOUGH_PLAYERS');

  const maxRounds = maxRoundsFor(d.config, d.tier);
  const totalRounds = Math.min(d.settings.rounds, maxRounds);
  if (deckSize(input.deck) < totalRounds) return reject(ctx, 'NOT_ENOUGH_QUESTIONS');

  if (input.config) d.config = input.config;
  const participants = activePlayerList(d);
  const levelOffset = presetOffset(d.config, d.settings.difficulty);
  d.game = {
    gameId: input.gameId,
    startedAt: at,
    totalRounds,
    finalLength: finalStageLength(totalRounds, d.config),
    deck: input.deck,
    director: {
      level: Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, d.config.director.startLevel + levelOffset)),
      levelOffset,
      chaos: 0,
      recentCorrectPermille: [],
      recentAvgAnswerPermille: [],
      recentRiskTakePermille: [],
      history: [],
      categoryCounts: {},
      prevCategory: null,
    },
    players: Object.fromEntries(
      participants.map((p) => [
        p.playerId,
        {
          score: 0,
          streak: 0,
          bestStreak: 0,
          correctCount: 0,
          answeredCount: 0,
          totalRemainingMs: 0,
          removed: false,
          rankHistory: [],
          powers: newLedger(d.config),
        },
      ]),
    ),
    roundIndex: -1,
    round: null,
    upcoming: null,
    results: null,
  };
  for (const p of participants) p.ready = false;
  d.awaitingDisplay = false;
  touch(d, at);
  enterPhase(d, 'COUNTDOWN', at, d.config.timings.countdownMs);
  ctx.effects.push({
    kind: 'persist',
    record: {
      type: 'GAME_STARTED',
      gameId: input.gameId,
      startedAt: at,
      totalRounds,
      playerIds: participants.map((p) => p.playerId),
      configVersion: d.config.version,
    },
  });
  ctx.effects.push({
    kind: 'telemetry',
    name: purpose === 'START' ? 'game_started' : 'rematch_started',
    props: { players: participants.length, rounds: totalRounds },
  });
}

// ───────────────────────────── powers ─────────────────────────────

function emitPlayerState(d: Room, ctx: Ctx, playerId: string): void {
  const you = youView(d, playerId);
  if (you) emit(ctx, { to: 'PLAYER', playerId }, { type: 'PLAYER_STATE', payload: { you } });
}

function emitAllPlayerStates(d: Room, ctx: Ctx): void {
  for (const player of activePlayerList(d)) emitPlayerState(d, ctx, player.playerId);
}

function commitPrep(
  d: Room,
  ctx: Ctx,
  at: number,
  playerId: string,
  payload: Extract<EngineCommand, { type: 'COMMIT_PREP' }>['payload'],
): void {
  const refused = checkCommit(d, playerId, payload);
  if (refused) return reject(ctx, refused);
  const game = d.game!;
  const round = game.round!;
  const me = game.players[playerId]!;
  const sabotage = payload.sabotage;
  round.commitments[playerId] = {
    stake: payload.stake,
    doubleDown: payload.doubleDown,
    sabotage: sabotage
      ? {
          targetId: sabotage.targetId,
          effect: sabotage.effect,
          joker: sabotage.effect === 'LOCKOUT' ? (sabotage.joker ?? null) : null,
        }
      : null,
    committedAt: at,
  };
  // Spent on commitment, even if the answer turns out wrong (ADR-0007).
  if (payload.doubleDown) me.powers.doubleDown -= 1;
  if (sabotage) {
    me.powers.tokens -= 1;
    me.powers.lastSabotageRound = round.index;
  }
  touch(d, at);
  emitPlayerState(d, ctx, playerId);
  const counts = prepCounts(d);
  emit(ctx, { to: 'ALL' }, { type: 'PREP_PROGRESS', payload: counts });
  // Everyone online has decided: no reason to keep the table waiting.
  if (counts.committedCount >= counts.eligibleCount) advancePhase(d, ctx, at);
}

function useFiftyFifty(d: Room, ctx: Ctx, at: number, playerId: string): void {
  const game = d.game;
  const round = game?.round;
  if (!game || !round || d.phase !== 'ANSWERING') return reject(ctx, 'INVALID_STATE');
  const me = game.players[playerId];
  if (!me || me.removed) return reject(ctx, 'POWER_UNAVAILABLE');
  if (round.answers[playerId]) return reject(ctx, 'INVALID_STATE');
  if (round.fiftyFiftyUsers[playerId] || me.powers.fiftyFifty <= 0)
    return reject(ctx, 'POWER_UNAVAILABLE');
  if (jokerLockedOut(me.powers, 'FIFTY_FIFTY', round.index)) return reject(ctx, 'POWER_LOCKED_OUT');
  const question = round.question!;
  if (question.options.length < 3) return reject(ctx, 'POWER_UNAVAILABLE');
  const cutoff =
    round.answerDeadlineAt! - jamFor(round, playerId) + d.config.timings.latencyAllowanceMs;
  if (at > cutoff) return reject(ctx, 'ANSWER_LATE');

  round.fiftyFifty ??= {
    keep: chooseFiftyFifty(question.options, question.correctOptionId, ctx.rng()),
  };
  round.fiftyFiftyUsers[playerId] = true;
  me.powers.fiftyFifty -= 1;
  touch(d, at);
  emitPlayerState(d, ctx, playerId);
}

/** How long QUESTION_PREP lasts: longer when stakes are the point of the round or powers are on offer. */
function prepDuration(d: Room): number {
  const t = d.config.timings;
  const game = d.game!;
  const round = game.round!;
  if (round.kind === 'RISK' || round.kind === 'FINAL') return t.prepDecisionMs;
  const ladder = roundLadder(d.config, round, game.totalRounds);
  const choices =
    ladder.rungs.length > 1 || doubleDownOffered(d.config) || sabotageOpen(d.config, round);
  return choices ? t.prepQuickMs : t.prepMs;
}

// ───────────────────────────── answering ─────────────────────────────

function submitAnswer(
  d: Room,
  ctx: Ctx,
  at: number,
  playerId: string,
  messageId: string,
  questionId: string,
  optionId: string,
): void {
  const game = d.game;
  const round = game?.round;
  if (!game || !round) return reject(ctx, 'INVALID_STATE');
  const gamePlayer = game.players[playerId];
  if (!gamePlayer || gamePlayer.removed) return reject(ctx, 'ANSWER_NOT_ALLOWED');

  if (d.phase !== 'ANSWERING') {
    const early = ['COUNTDOWN', 'ROUND_INTRO', 'FINAL', 'QUESTION_PREP', 'QUESTION'].includes(
      d.phase,
    );
    return reject(ctx, early ? 'INVALID_STATE' : 'ANSWER_LATE');
  }
  const question = round.question!;
  if (question.questionId !== questionId) return reject(ctx, 'QUESTION_MISMATCH');
  const option = question.options.find((o) => o.optionId === optionId);
  if (!option) return reject(ctx, 'OPTION_INVALID');
  if (round.answers[playerId]) return reject(ctx, 'ANSWER_DUPLICATE');
  // 50/50 removed this option for this player.
  if (round.fiftyFiftyUsers[playerId] && !round.fiftyFifty?.keep.includes(optionId))
    return reject(ctx, 'OPTION_INVALID');

  // A JAM shortens this player's own window; everyone else keeps the full one.
  const deadline = round.answerDeadlineAt! - jamFor(round, playerId);
  const cutoff = deadline + d.config.timings.latencyAllowanceMs;
  if (at > cutoff) return reject(ctx, 'ANSWER_LATE');

  const remainingMs = clamp(deadline - at, 0, round.answerMs);
  const offsetMs = Math.max(0, at - round.answerOpensAt!);
  round.answers[playerId] = { optionId, remainingMs, offsetMs };
  touch(d, at);

  emit(
    ctx,
    { to: 'PLAYER', playerId },
    {
      type: 'ANSWER_ACCEPTED',
      payload: { messageId, questionId, optionId, lockedAt: round.answerOpensAt! + offsetMs },
    },
  );
  const eligible = eligiblePlayerIds(d, at);
  emit(
    ctx,
    { to: 'ALL' },
    {
      type: 'ANSWER_LOCKED',
      payload: {
        playerId,
        answeredCount: Object.keys(round.answers).length,
        eligibleCount: Math.max(eligible.length, Object.keys(round.answers).length),
      },
    },
  );
  const you = youView(d, playerId);
  if (you) emit(ctx, { to: 'PLAYER', playerId }, { type: 'PLAYER_STATE', payload: { you } });
  maybeEarlyLock(d, ctx, at);
}

function eligiblePlayerIds(d: Room, at: number): string[] {
  const game = d.game;
  if (!game) return [];
  const grace = d.config.timings.earlyLockGraceMs;
  return Object.entries(game.players)
    .filter(([playerId, gamePlayer]) => {
      if (gamePlayer.removed) return false;
      const player = d.players[playerId];
      if (!player || player.status !== 'ACTIVE') return false;
      if (player.connection === 'CONNECTED') return true;
      return player.disconnectedAt !== null && at - player.disconnectedAt < grace;
    })
    .map(([playerId]) => playerId);
}

function maybeEarlyLock(d: Room, ctx: Ctx, at: number): void {
  const round = d.game?.round;
  if (d.phase !== 'ANSWERING' || !round) return;
  const eligible = eligiblePlayerIds(d, at);
  if (eligible.length === 0) return;
  if (eligible.every((playerId) => round.answers[playerId] !== undefined)) lockRound(d, ctx, at);
}

function lockRound(d: Room, _ctx: Ctx, at: number): void {
  const game = d.game!;
  const round = game.round!;
  const question = round.question!;
  round.lockedAt = at;

  const outcome: RoundOutcome = {
    players: {},
    distribution: {},
    eligibleCount: 0,
    correctCount: 0,
  };
  for (const option of question.options) outcome.distribution[option.optionId] = 0;

  for (const [playerId, gamePlayer] of Object.entries(game.players)) {
    if (gamePlayer.removed) continue;
    const player = d.players[playerId];
    if (!player || player.status !== 'ACTIVE') continue;
    const answer = round.answers[playerId];
    const commitment = round.commitments[playerId];
    const tax = gamePlayer.powers.pointTax;
    const score = computeScore(
      {
        roundKind: round.kind,
        ladderKind: ladderKindFor(round.kind, round.index === game.totalRounds - 1),
        answered: answer !== undefined,
        correct: answer !== undefined && answer.optionId === question.correctOptionId,
        remainingMs: answer?.remainingMs ?? 0,
        answerMs: round.answerMs,
        stake: commitment?.stake,
        doubleDown: commitment?.doubleDown ?? false,
        fiftyFifty: round.fiftyFiftyUsers[playerId] === true,
        pointTaxPending: tax !== null && round.index <= tax.expiresAfterRound,
        connectedAtLock: player.connection === 'CONNECTED',
        currentScore: gamePlayer.score,
      },
      d.config,
    );
    if (score.consumedPointTax) gamePlayer.powers.pointTax = null;
    outcome.players[playerId] = {
      result: score.outcome,
      delta: score.delta,
      components: score.components,
      consumedPointTax: score.consumedPointTax,
      optionId: answer?.optionId ?? null,
      remainingMs: answer?.remainingMs ?? 0,
    };
    outcome.eligibleCount += 1;
    if (score.outcome === 'CORRECT') outcome.correctCount += 1;
    if (answer)
      outcome.distribution[answer.optionId] = (outcome.distribution[answer.optionId] ?? 0) + 1;
  }
  round.outcome = outcome;
  enterPhase(d, 'LOCKED', at, d.config.timings.lockedMs);
}

// ───────────────────────────── ticking through the game ─────────────────────────────

function onTick(d: Room, ctx: Ctx, at: number): void {
  const t = d.config.timings;
  if (at - d.createdAt >= t.maxLifetimeMs) return closeRoom(d, ctx, at, 'LIFETIME');

  const idleLimit =
    d.phase === 'WAITING' || d.phase === 'LOBBY'
      ? t.lobbyIdleMs
      : d.phase === 'RESULTS'
        ? t.resultsIdleMs
        : null;
  if (idleLimit !== null && at - d.lastActivityAt >= idleLimit)
    return closeRoom(d, ctx, at, 'IDLE');

  if (isInGamePhase(d.phase) && !d.display.connected && d.display.disconnectedAt !== null) {
    if (at - d.display.disconnectedAt >= t.abandonMs) return closeRoom(d, ctx, at, 'ABANDONED');
  }

  if (
    d.leaderPlayerId !== null &&
    d.leaderLostAt !== null &&
    at - d.leaderLostAt >= t.leaderGraceMs
  ) {
    const next = pickLeader(d, d.leaderPlayerId);
    if (next !== null) setLeader(d, ctx, next);
    else d.leaderLostAt = null;
  }

  if (d.phaseDeadlineAt !== null && at >= d.phaseDeadlineAt) {
    advancePhase(d, ctx, at);
  } else if (d.phase === 'ANSWERING') {
    maybeEarlyLock(d, ctx, at);
  }
}

function advancePhase(d: Room, ctx: Ctx, at: number): void {
  const t = d.config.timings;
  switch (d.phase) {
    case 'COUNTDOWN':
      return startRound(d, ctx, at, d.game!.upcoming ?? planRound(d, ctx, 0));
    case 'ROUND_INTRO':
    case 'FINAL':
      enterPhase(d, 'QUESTION_PREP', at, prepDuration(d));
      emitAllPlayerStates(d, ctx); // fresh round: nothing committed, lockouts and tokens as they stand
      return;
    case 'QUESTION_PREP': {
      presentQuestion(d, ctx);
      resolveSabotage(d, ctx.rng());
      const round = d.game!.round!;
      round.questionStartedAt = at;
      const text = round.question!.text;
      const readMs = clamp(t.readBaseMs + t.readPerCharMs * text.length, t.readMinMs, t.readMaxMs);
      enterPhase(d, 'QUESTION', at, readMs);
      // After the phase change, so views already show what hit whom: targets learn what hit them,
      // and everyone's shield and token counts are current.
      emitAllPlayerStates(d, ctx);
      return;
    }
    case 'QUESTION': {
      const round = d.game!.round!;
      round.answerOpensAt = at;
      round.answerDeadlineAt = at + round.answerMs;
      // Locks at the first tick strictly after the cut-off (the deadline itself is still on time).
      enterPhase(d, 'ANSWERING', at, round.answerMs + t.latencyAllowanceMs + 1);
      return;
    }
    case 'ANSWERING':
      return lockRound(d, ctx, at);
    case 'LOCKED': {
      const explanation = d.game!.round!.question!.explanation;
      const readMs = explanation
        ? Math.min(explanation.length * t.revealPerCharMs, t.revealExplanationMaxMs)
        : 0;
      return enterPhase(d, 'REVEAL', at, t.revealMs + readMs);
    }
    case 'REVEAL': {
      const round = d.game!.round!;
      round.powerItems = buildPowerItems(d);
      if (round.powerItems.length === 0) return enterScoreUpdate(d, ctx, at);
      const extra = t.powerResolutionPerItemMs * (round.powerItems.length - 1);
      return enterPhase(
        d,
        'POWER_RESOLUTION',
        at,
        Math.min(t.powerResolutionMaxMs, t.powerResolutionMs + extra),
      );
    }
    case 'POWER_RESOLUTION':
      return enterScoreUpdate(d, ctx, at);
    case 'SCORE_UPDATE': {
      const game = d.game!;
      if (game.roundIndex >= game.totalRounds - 1) return enterResults(d, ctx, at);
      planRound(d, ctx, game.roundIndex + 1);
      return enterPhase(d, 'MICRO_INTERMISSION', at, t.microIntermissionMs);
    }
    case 'MICRO_INTERMISSION': {
      const game = d.game!;
      d.phase = 'NEXT_ROUND';
      return startRound(d, ctx, at, game.upcoming ?? planRound(d, ctx, game.roundIndex + 1));
    }
    case 'WAITING':
    case 'LOBBY':
    case 'NEXT_ROUND':
    case 'RESULTS':
    case 'ROOM_CLOSED':
      d.phaseDeadlineAt = null;
  }
}

function planRound(d: Room, ctx: Ctx, index: number): UpcomingRound {
  const game = d.game!;
  const cfg = d.config as GameConfig;
  const out = direct(
    {
      roundIndex: index,
      totalRounds: game.totalRounds,
      level: game.director.level,
      recentCorrectPermille: game.director.recentCorrectPermille,
      recentAvgAnswerPermille: game.director.recentAvgAnswerPermille,
      recentRiskTakePermille: game.director.recentRiskTakePermille,
      chaos: game.director.chaos,
      finalLength: game.finalLength,
      levelOffset: game.director.levelOffset,
    },
    cfg.director,
  );
  const rng = ctx.rng();
  const kind = chooseRoundKind(
    {
      roundIndex: index,
      totalRounds: game.totalRounds,
      finalLength: game.finalLength,
      history: game.director.history,
      specialEventPermille: out.specialEventPermille,
      riskIntensity: out.riskIntensity,
    },
    cfg.director,
    rng,
  );
  const questionId =
    selectQuestionId(
      game.deck,
      {
        bucket: out.bucket,
        varianceBuckets: out.varianceBuckets,
        corridor: out.corridor,
        prevCategory: game.director.prevCategory,
        categoryCounts: game.director.categoryCounts,
      },
      rng,
    ) ?? '';
  game.director.level = out.level;
  game.director.chaos = out.chaos;
  const plan: UpcomingRound = { index, kind, questionId };
  game.upcoming = plan;
  return plan;
}

function startRound(d: Room, ctx: Ctx, at: number, plan: UpcomingRound): void {
  const game = d.game!;
  const t = d.config.timings;
  if (plan.questionId === '' || !game.deck.questions[plan.questionId]) {
    return enterResults(d, ctx, at); // deck exhausted: finish with the rounds played so far
  }
  // Hold at a round boundary while the display has been gone longer than its grace period.
  if (
    !d.display.connected &&
    d.display.disconnectedAt !== null &&
    at - d.display.disconnectedAt >= t.displayGraceMs
  ) {
    d.awaitingDisplay = true;
    if (d.phase === 'NEXT_ROUND') d.phase = 'MICRO_INTERMISSION';
    d.phaseDeadlineAt = null;
    emitDisplayStatus(d, ctx);
    return;
  }
  const deckQuestion = game.deck.questions[plan.questionId]!;
  const ids = game.deck.remaining[deckQuestion.difficulty];
  game.deck.remaining[deckQuestion.difficulty] = ids.filter((id) => id !== plan.questionId);
  const previousKind = game.director.history.at(-1);
  game.director.history.push(plan.kind);
  game.director.categoryCounts[deckQuestion.category.id] =
    (game.director.categoryCounts[deckQuestion.category.id] ?? 0) + 1;
  game.director.prevCategory = deckQuestion.category.id;

  const cfg = d.config;
  game.roundIndex = plan.index;
  game.upcoming = null;
  game.round = {
    index: plan.index,
    kind: plan.kind,
    isFinal: plan.kind === 'FINAL',
    basePoints: cfg.scoring.basePoints[plan.kind],
    speedMax: cfg.scoring.speedMax[plan.kind],
    answerMs: cfg.timings.answerMs[plan.kind],
    questionId: plan.questionId,
    question: null,
    questionStartedAt: null,
    answerOpensAt: null,
    answerDeadlineAt: null,
    lockedAt: null,
    answers: {},
    commitments: {},
    sabotages: [],
    effects: {},
    fiftyFifty: null,
    fiftyFiftyUsers: {},
    powerItems: [],
    outcome: null,
    scoreUpdate: null,
  };
  // The "Final" splash plays once, before the first question of the final stage.
  if (plan.kind === 'FINAL' && previousKind !== 'FINAL') enterPhase(d, 'FINAL', at, t.finalIntroMs);
  else enterPhase(d, 'ROUND_INTRO', at, t.roundIntroMs);
}

function opaqueId(rng: Rng, taken: Set<string>): string {
  for (;;) {
    let id = '';
    for (let i = 0; i < 12; i++) id += OPAQUE_ALPHABET[rng.int(OPAQUE_ALPHABET.length)];
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

function presentQuestion(d: Room, ctx: Ctx): void {
  const game = d.game!;
  const round = game.round!;
  const source = game.deck.questions[round.questionId]!;
  const rng = ctx.rng();
  const taken = new Set<string>();
  const shuffled = rng.shuffle(
    source.options.map((o) => ({ key: o.key, text: o.text, correct: o.correct })),
  );
  const options: PresentedOption[] = shuffled.map((o) => ({
    optionId: opaqueId(rng, taken),
    key: o.key,
    text: o.text,
    correct: o.correct,
  }));
  const question: PresentedQuestion = {
    questionId: source.questionId,
    text: source.text,
    category: { id: source.category.id, label: source.category.label },
    difficulty: source.difficulty,
    explanation: source.explanation,
    options,
    correctOptionId: options.find((o) => o.correct)!.optionId,
  };
  round.question = question;
}

function enterScoreUpdate(d: Room, ctx: Ctx, at: number): void {
  const game = d.game!;
  const round = game.round!;
  const outcome = round.outcome!;
  const joinIndexOf = (playerId: string): number =>
    d.players[playerId]?.joinIndex ?? Number.MAX_SAFE_INTEGER;

  const rankOf = (): Map<string, number> =>
    new Map(
      rankPlayers(
        Object.entries(game.players)
          .filter(([, gp]) => !gp.removed)
          .map(([playerId, gp]) => ({
            playerId,
            score: gp.score,
            correctCount: gp.correctCount,
            totalRemainingMs: gp.totalRemainingMs,
            joinIndex: joinIndexOf(playerId),
          })),
      ).map((entry) => [entry.playerId, entry.rank]),
    );

  const before = rankOf();
  for (const [playerId, result] of Object.entries(outcome.players)) {
    const gp = game.players[playerId];
    if (!gp || gp.removed) continue;
    gp.score = Math.max(0, gp.score + result.delta);
    if (result.result === 'CORRECT') {
      gp.streak += 1;
      gp.bestStreak = Math.max(gp.bestStreak, gp.streak);
      gp.correctCount += 1;
      gp.totalRemainingMs += result.remainingMs;
      earnToken(d.config, gp.powers, gp.streak);
    } else {
      gp.streak = 0;
    }
    if (result.optionId !== null) gp.answeredCount += 1;
  }
  // Whatever has run its course this round lapses: unspent POINT_TAX, and a lockout that held for it.
  for (const gp of Object.values(game.players)) {
    if (gp.powers.pointTax && round.index >= gp.powers.pointTax.expiresAfterRound)
      gp.powers.pointTax = null;
    if (gp.powers.lockout && gp.powers.lockout.round <= round.index) gp.powers.lockout = null;
  }
  const after = rankOf();
  for (const [playerId, rank] of after) game.players[playerId]!.rankHistory.push(rank);

  const board = rankPlayers(
    Object.entries(game.players)
      .filter(([, gp]) => !gp.removed)
      .map(([playerId, gp]) => ({
        playerId,
        score: gp.score,
        correctCount: gp.correctCount,
        totalRemainingMs: gp.totalRemainingMs,
        joinIndex: joinIndexOf(playerId),
      })),
  );
  const deltas = d.playerOrder
    .filter((playerId) => outcome.players[playerId] !== undefined)
    .map((playerId) => {
      const result = outcome.players[playerId]!;
      return {
        playerId,
        delta: result.delta,
        total: game.players[playerId]!.score,
        rank: after.get(playerId) ?? 1,
        previousRank: before.get(playerId) ?? 1,
        components: result.components.map((c) => ({ kind: c.kind, points: c.points })),
      };
    });
  round.scoreUpdate = {
    deltas,
    scoreboard: board.map((entry) => ({
      playerId: entry.playerId,
      score: entry.score,
      rank: entry.rank,
      streak: game.players[entry.playerId]!.streak,
    })),
  };

  // Director aggregates for the next round: room-level only (ADR-0011).
  const answered = Object.values(outcome.players).filter((p) => p.optionId !== null);
  const eligible = Math.max(1, outcome.eligibleCount);
  game.director.recentCorrectPermille.push(Math.floor((outcome.correctCount * 1000) / eligible));
  const used =
    answered.length === 0
      ? 1000
      : Math.floor(
          answered.reduce(
            (sum, p) => sum + ((round.answerMs - p.remainingMs) * 1000) / round.answerMs,
            0,
          ) / answered.length,
        );
  game.director.recentAvgAnswerPermille.push(used);
  // Share of the room that took a stake above the default or doubled down (ADR-0011, riskIntensity).
  const ladder = roundLadder(d.config, round, game.totalRounds);
  const risked = Object.entries(round.commitments).filter(
    ([playerId, commitment]) =>
      outcome.players[playerId] !== undefined &&
      (commitment.stake !== ladder.defaultTier || commitment.doubleDown),
  ).length;
  game.director.recentRiskTakePermille.push(Math.floor((risked * 1000) / eligible));

  const keyOf = new Map(round.question!.options.map((o) => [o.optionId, o.key]));
  const distributionByKey: Record<string, number> = {};
  for (const [optionId, count] of Object.entries(outcome.distribution)) {
    distributionByKey[keyOf.get(optionId) ?? optionId] = count;
  }
  ctx.effects.push({
    kind: 'persist',
    record: {
      type: 'ROUND_COMPLETED',
      gameId: game.gameId,
      roundIndex: round.index,
      kind: round.kind,
      questionId: round.questionId,
      answerMs: round.answerMs,
      correctOptionKey: keyOf.get(round.question!.correctOptionId) ?? '',
      distribution: distributionByKey,
      players: deltas.map((entry) => {
        const result = outcome.players[entry.playerId]!;
        return {
          playerId: entry.playerId,
          optionKey: result.optionId === null ? null : (keyOf.get(result.optionId) ?? null),
          correct: result.result === 'CORRECT',
          remainingMs: result.remainingMs,
          delta: result.delta,
          totalAfter: entry.total,
          components: entry.components,
          stake: round.commitments[entry.playerId]?.stake ?? null,
          doubleDown: round.commitments[entry.playerId]?.doubleDown ?? false,
          fiftyFifty: round.fiftyFiftyUsers[entry.playerId] === true,
        };
      }),
      sabotages: round.sabotages.map((record) => ({ ...record })),
      configVersion: d.config.version,
    },
  });
  ctx.effects.push({
    kind: 'telemetry',
    name: 'question_revealed',
    props: {
      round: round.index,
      correctRatePermille: Math.floor((outcome.correctCount * 1000) / eligible),
    },
  });
  enterPhase(d, 'SCORE_UPDATE', at, d.config.timings.scoreUpdateMs);
}

function enterResults(d: Room, ctx: Ctx, at: number): void {
  const game = d.game!;
  const joinIndexOf = (playerId: string): number =>
    d.players[playerId]?.joinIndex ?? Number.MAX_SAFE_INTEGER;
  const entries = Object.entries(game.players)
    .filter(([, gp]) => !gp.removed)
    .map(([playerId, gp]) => ({
      playerId,
      score: gp.score,
      correctCount: gp.correctCount,
      totalRemainingMs: gp.totalRemainingMs,
      joinIndex: joinIndexOf(playerId),
    }));
  const ranked = rankPlayers(entries);
  const ranking = ranked.map((entry) => ({
    playerId: entry.playerId,
    score: entry.score,
    rank: entry.rank,
    correctCount: entry.correctCount,
    bestStreak: game.players[entry.playerId]!.bestStreak,
  }));

  const awards: ResultsRecord['awards'] = [];
  const best = <T>(items: T[], score: (item: T) => number): T | undefined =>
    items.slice().sort((a, b) => score(b) - score(a))[0];
  const sharp = best(ranked, (e) => e.correctCount * 1_000_000 + e.score);
  if (sharp && sharp.correctCount > 0)
    awards.push({ kind: 'SHARPSHOOTER', playerId: sharp.playerId });
  const fast = best(
    ranked.filter((e) => e.correctCount >= 2),
    (e) => Math.floor(e.totalRemainingMs / e.correctCount),
  );
  if (fast) awards.push({ kind: 'FASTEST_FINGER', playerId: fast.playerId });
  const streak = best(ranking, (e) => e.bestStreak);
  if (streak && streak.bestStreak >= 3)
    awards.push({ kind: 'STREAK_MASTER', playerId: streak.playerId });
  const comeback = best(
    ranking.filter((e) => e.rank <= 3),
    (e) => Math.max(...game.players[e.playerId]!.rankHistory, e.rank) - e.rank,
  );
  if (
    comeback &&
    Math.max(...game.players[comeback.playerId]!.rankHistory, comeback.rank) - comeback.rank >= 2
  ) {
    awards.push({ kind: 'COMEBACK', playerId: comeback.playerId });
  }

  game.results = { ranking, awards };
  game.upcoming = null;
  enterPhase(d, 'RESULTS', at, null);
  touch(d, at);
  ctx.effects.push({
    kind: 'persist',
    record: { type: 'GAME_FINISHED', gameId: game.gameId, finishedAt: at, ranking },
  });
  ctx.effects.push({
    kind: 'telemetry',
    name: 'game_finished',
    props: { players: ranking.length, rounds: game.roundIndex + 1 },
  });
}

// ───────────────────────────── entitlement & recovery ─────────────────────────────

function onEntitlement(d: Room, ctx: Ctx, tier: Tier, hostAccountId: string | null): void {
  const changed = d.tier !== tier || d.hostAccountId !== hostAccountId;
  if (!changed) return;
  const tierChanged = d.tier !== tier;
  d.tier = tier;
  d.hostAccountId = hostAccountId;
  if (tierChanged) {
    emit(
      ctx,
      { to: 'ALL' },
      {
        type: 'ENTITLEMENT_CHANGED',
        payload: { tier, reason: tier === 'FULL' ? 'LINKED' : 'REVOKED' },
      },
    );
    if (tier === 'FREE' && d.settings.rounds > d.config.freeTier.maxRounds) {
      d.settings.rounds = d.config.freeTier.maxRounds;
      emit(
        ctx,
        { to: 'ALL' },
        { type: 'SETTINGS_CHANGED', payload: { settings: structuredSettings(d) } },
      );
    }
  }
}

function onRecover(d: Room, ctx: Ctx, at: number, outageMs: number): void {
  if (outageMs > d.config.timings.maxRecoverableOutageMs) {
    return closeRoom(d, ctx, at, 'INTERRUPTED');
  }
  const shift = Math.max(0, outageMs);
  d.phaseEnteredAt += shift;
  if (d.phaseDeadlineAt !== null) d.phaseDeadlineAt += shift;
  const round = d.game?.round;
  if (round) {
    if (round.questionStartedAt !== null) round.questionStartedAt += shift;
    if (round.answerOpensAt !== null) round.answerOpensAt += shift;
    if (round.answerDeadlineAt !== null) round.answerDeadlineAt += shift;
    if (round.lockedAt !== null) round.lockedAt += shift;
  }
  d.lastActivityAt = at;
  d.display.connected = false;
  d.display.disconnectedAt = at;
  for (const player of activePlayerList(d)) {
    player.connection = 'DISCONNECTED';
    player.disconnectedAt = at;
  }
  d.leaderLostAt = d.leaderPlayerId === null ? null : at;
}
