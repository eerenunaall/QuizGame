import type {
  CloseReason,
  ClientPayload,
  Difficulty,
  ErrorCode,
  LobbySettings,
  Locale,
  Outcome,
  Phase,
  RiskTier,
  RoundKind,
  ScoreComponent,
  ServerEvent,
  Tier,
} from '@quizparty/protocol';
import type { GameConfig } from './config';
import type { Deck } from './deck';

export type EpochMs = number;

/** Who is issuing a command, as resolved by the server from an authenticated session. */
export type Actor =
  { role: 'DISPLAY'; sessionId: string } | { role: 'PLAYER'; sessionId: string; playerId: string };

export interface Player {
  playerId: string;
  sessionId: string;
  nickname: string;
  /** Confusable-folded, case-folded key used for per-room uniqueness (computed by the server). */
  nicknameKey: string;
  avatarId: string;
  colorSlot: number;
  joinIndex: number;
  ready: boolean;
  connection: 'CONNECTED' | 'DISCONNECTED';
  disconnectedAt: EpochMs | null;
  status: 'ACTIVE' | 'KICKED' | 'LEFT';
}

export interface AnswerRecord {
  optionId: string;
  /** Time left on the clock at acceptance; stored instead of absolute time so it survives shifts. */
  remainingMs: number;
  /** Milliseconds after `answerOpensAt` at which the answer was accepted. */
  offsetMs: number;
}

export interface PresentedOption {
  optionId: string;
  text: string;
  /** PRIVATE. Never copied into any view. */
  correct: boolean;
}

export interface PresentedQuestion {
  questionId: string;
  text: string;
  category: { id: string; label: string };
  difficulty: Difficulty;
  explanation: string | null;
  options: PresentedOption[];
  /** PRIVATE until REVEAL. */
  correctOptionId: string;
}

export interface PlayerRoundOutcome {
  result: Outcome;
  delta: number;
  components: ScoreComponent[];
  consumedPointTax: boolean;
  optionId: string | null;
  remainingMs: number;
}

export interface RoundOutcome {
  players: Record<string, PlayerRoundOutcome>;
  distribution: Record<string, number>;
  eligibleCount: number;
  correctCount: number;
}

export interface ScoreUpdateRecord {
  deltas: {
    playerId: string;
    delta: number;
    total: number;
    rank: number;
    previousRank: number;
    components: ScoreComponent[];
  }[];
  scoreboard: { playerId: string; score: number; rank: number; streak: number }[];
}

export interface RoundState {
  index: number;
  kind: RoundKind;
  isFinal: boolean;
  basePoints: number;
  speedMax: number;
  answerMs: number;
  questionId: string;
  /** Materialized (options shuffled, opaque ids) when QUESTION is entered. */
  question: PresentedQuestion | null;
  questionStartedAt: EpochMs | null;
  answerOpensAt: EpochMs | null;
  answerDeadlineAt: EpochMs | null;
  lockedAt: EpochMs | null;
  answers: Record<string, AnswerRecord>;
  /** PRIVATE until REVEAL (results) / SCORE_UPDATE (deltas). */
  outcome: RoundOutcome | null;
  scoreUpdate: ScoreUpdateRecord | null;
}

export interface GamePlayerState {
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  answeredCount: number;
  totalRemainingMs: number;
  removed: boolean;
  rankHistory: number[];
}

export interface DirectorState {
  level: number;
  chaos: number;
  recentCorrectPermille: number[];
  recentAvgAnswerPermille: number[];
  recentRiskTakePermille: number[];
  history: RoundKind[];
  categoryCounts: Record<string, number>;
  prevCategory: string | null;
}

export interface UpcomingRound {
  index: number;
  kind: RoundKind;
  questionId: string;
}

export interface ResultsRecord {
  ranking: {
    playerId: string;
    score: number;
    rank: number;
    correctCount: number;
    bestStreak: number;
  }[];
  awards: {
    kind: 'SHARPSHOOTER' | 'FASTEST_FINGER' | 'STREAK_MASTER' | 'COMEBACK';
    playerId: string;
  }[];
}

export interface GameState {
  gameId: string;
  startedAt: EpochMs;
  totalRounds: number;
  /** PRIVATE: contains correct answers. */
  deck: Deck;
  director: DirectorState;
  players: Record<string, GamePlayerState>;
  roundIndex: number;
  round: RoundState | null;
  upcoming: UpcomingRound | null;
  results: ResultsRecord | null;
}

export interface RoomState {
  schemaVersion: 1;
  roomId: string;
  code: string;
  /** Monotonic count of applied (state-changing) inputs. */
  version: number;
  createdAt: EpochMs;
  lastActivityAt: EpochMs;
  phase: Phase;
  phaseEnteredAt: EpochMs;
  /** When the next automatic transition is due; null when the phase waits for a person or a display. */
  phaseDeadlineAt: EpochMs | null;
  tier: Tier;
  hostAccountId: string | null;
  contentLanguage: Locale;
  settings: LobbySettings;
  config: GameConfig;
  display: { sessionId: string; connected: boolean; disconnectedAt: EpochMs | null };
  awaitingDisplay: boolean;
  leaderPlayerId: string | null;
  leaderLostAt: EpochMs | null;
  nextJoinIndex: number;
  players: Record<string, Player>;
  /** Join order of ACTIVE players. */
  playerOrder: string[];
  game: GameState | null;
  closed: { reason: CloseReason; at: EpochMs } | null;
}

export type EngineCommandType =
  | 'READY'
  | 'SET_NICKNAME'
  | 'SUBMIT_ANSWER'
  | 'LEAVE_ROOM'
  | 'SET_SETTINGS'
  | 'KICK_PLAYER'
  | 'TRANSFER_LEADER'
  | 'START_GAME'
  | 'REMATCH'
  | 'BACK_TO_LOBBY'
  | 'END_ROOM';

export type EngineCommand = {
  [K in EngineCommandType]: { type: K; payload: ClientPayload<K> };
}[EngineCommandType];

interface InputBase {
  /** Server time at which the input was received (never a client clock). */
  at: EpochMs;
  /** Server-generated random string; the only source of randomness for this input (ADR-0006). */
  entropy: string;
}

export interface JoinRequest {
  playerId: string;
  sessionId: string;
  nickname: string;
  nicknameKey: string;
  avatarId: string;
}

export type EngineInput =
  | (InputBase & { kind: 'DISPLAY_CONNECTION'; connected: boolean })
  | (InputBase & { kind: 'PLAYER_JOIN'; player: JoinRequest })
  | (InputBase & { kind: 'PLAYER_CONNECTION'; playerId: string; connected: boolean })
  | (InputBase & {
      kind: 'COMMAND';
      actor: Actor;
      command: EngineCommand;
      /** Client idempotency key, echoed in replies and logged for exact replay. */
      messageId: string;
      nicknameKey?: string;
    })
  | (InputBase & {
      kind: 'BEGIN_GAME';
      requestedBy: Actor;
      purpose: 'START' | 'REMATCH';
      gameId: string;
      deck: Deck;
      config?: GameConfig;
    })
  | (InputBase & { kind: 'TICK' })
  | (InputBase & {
      kind: 'ENTITLEMENT';
      tier: Tier;
      hostAccountId: string | null;
    })
  | (InputBase & { kind: 'RECOVER'; outageMs: number })
  | (InputBase & { kind: 'CLOSE'; reason: CloseReason });

export type Audience =
  { to: 'ALL' } | { to: 'DISPLAY' } | { to: 'PLAYERS' } | { to: 'PLAYER'; playerId: string };

export interface DeckRequest {
  rounds: number;
  categories: string[] | 'ALL';
  language: Locale;
  tier: Tier;
  hostAccountId: string | null;
  playerCount: number;
}

export type PersistRecord =
  | {
      type: 'GAME_STARTED';
      gameId: string;
      startedAt: EpochMs;
      totalRounds: number;
      playerIds: string[];
      configVersion: number;
    }
  | {
      type: 'ROUND_COMPLETED';
      gameId: string;
      roundIndex: number;
      kind: RoundKind;
      questionId: string;
      answerMs: number;
      distribution: Record<string, number>;
      players: {
        playerId: string;
        optionId: string | null;
        correct: boolean;
        remainingMs: number;
        delta: number;
        totalAfter: number;
        components: ScoreComponent[];
        stake: RiskTier | null;
      }[];
      configVersion: number;
    }
  | {
      type: 'GAME_FINISHED';
      gameId: string;
      finishedAt: EpochMs;
      ranking: ResultsRecord['ranking'];
    };

export type Effect =
  | { kind: 'emit'; audience: Audience; event: ServerEvent }
  | { kind: 'needDeck'; purpose: 'START' | 'REMATCH'; request: DeckRequest; requestedBy: Actor }
  | { kind: 'persist'; record: PersistRecord }
  | { kind: 'telemetry'; name: string; props: Record<string, string | number | boolean> }
  | { kind: 'kick'; playerId: string; reason: 'KICKED' | 'LEFT' }
  | { kind: 'closeRoom'; reason: CloseReason };

export type CommandResult = { ok: true } | { ok: false; code: ErrorCode };

export interface ReduceResult {
  state: RoomState;
  effects: Effect[];
  result: CommandResult;
  /** True when the state changed (and `state.version` advanced). Only changed inputs are logged. */
  changed: boolean;
}
