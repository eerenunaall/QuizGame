import type {
  PhaseData,
  PublicPlayer,
  RoomView,
  ServerMessage,
  YouView,
} from '@quizparty/protocol';
import { INITIAL_CLIENT_STATE, type ClientState } from './types';

/** Test fixtures (not part of the public surface). */

export const ROOM_ID = '11111111-1111-4111-8111-111111111111';

export function player(index: number, patch: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    playerId: `p${index}`,
    nickname: `Player${index}`,
    avatarId: 'fox',
    colorSlot: index + 1,
    joinIndex: index,
    connection: 'CONNECTED',
    ready: false,
    isLeader: index === 0,
    ...patch,
  };
}

export function you(playerId: string, patch: Partial<YouView> = {}): YouView {
  return {
    playerId,
    isLeader: false,
    canHost: false,
    answer: null,
    powers: null,
    commitment: null,
    fiftyFifty: null,
    effects: null,
    hits: [],
    reducedEffects: false,
    ...patch,
  };
}

export function roomView(patch: Partial<RoomView> = {}): RoomView {
  return {
    roomId: ROOM_ID,
    code: 'ABC234',
    stateVersion: 1,
    serverTime: 1_000,
    phase: 'LOBBY',
    phaseEnteredAt: 1_000,
    phaseDeadlineAt: null,
    tier: 'FREE',
    contentLanguage: 'tr',
    maxPlayers: 4,
    limits: { maxRounds: 20 },
    settings: { mode: 'CLASSIC', rounds: 5, difficulty: 'MEDIUM', categories: 'ALL' },
    displayConnected: true,
    awaitingDisplay: false,
    players: [player(0), player(1)],
    game: null,
    phaseData: { phase: 'LOBBY' },
    you: you('p1'),
    ...patch,
  };
}

export const ROUND = {
  index: 0,
  total: 5,
  kind: 'STANDARD',
  isFinal: false,
  finalStage: null,
  basePoints: 1000,
  speedMax: 500,
  answerMs: 15_000,
} as const;

export function answeringData(
  patch: Partial<Extract<PhaseData, { phase: 'ANSWERING' }>> = {},
): PhaseData {
  return {
    phase: 'ANSWERING',
    round: ROUND,
    questionId: 'q1',
    text: 'Başkent?',
    options: [
      { optionId: 'optionAAAA', text: 'Ankara' },
      { optionId: 'optionBBBB', text: 'İstanbul' },
    ],
    category: { id: 'geography', label: 'Coğrafya' },
    difficulty: 'EASY',
    questionStartedAt: 1_000,
    answerOpensAt: 1_500,
    answerDeadlineAt: 16_500,
    answeredPlayerIds: [],
    ...patch,
  };
}

let serial = 0;
let sequence = 0;

export function message(
  type: ServerMessage['type'],
  payload: unknown,
  extra: { stateVersion?: number; sequence?: number } = {},
): ServerMessage {
  serial += 1;
  sequence = extra.sequence ?? sequence + 1;
  return {
    type,
    protocolVersion: 1,
    messageId: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    roomId: ROOM_ID,
    sessionId: null,
    sequence,
    timestamp: 2_000,
    ...(extra.stateVersion === undefined ? {} : { stateVersion: extra.stateVersion }),
    payload,
  } as ServerMessage;
}

export function stateWith(room: RoomView | null, patch: Partial<ClientState> = {}): ClientState {
  return { ...INITIAL_CLIENT_STATE, transport: 'ONLINE', room, ...patch };
}
