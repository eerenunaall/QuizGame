import { z } from 'zod';
import {
  CloseReasonSchema,
  ConnectionSchema,
  EpochMsSchema,
  ErrorParamsSchema,
  OptionIdSchema,
  PlayerIdSchema,
  QuestionIdSchema,
  SequenceSchema,
  TierSchema,
  UuidSchema,
} from './common';
import { ErrorCodeSchema } from './errors';
import {
  LobbySettingsSchema,
  PhaseDataSchema,
  PublicPlayerSchema,
  RoomViewSchema,
  YouViewSchema,
} from './views';

/** Envelope fields shared by every server → client message. */
export const serverEnvelopeShape = {
  protocolVersion: z.int().positive(),
  messageId: UuidSchema,
  roomId: UuidSchema.nullable(),
  /** Recipient's session id (null before a session exists). */
  sessionId: UuidSchema.nullable(),
  /** Per-connection counter; a gap tells the client to send REQUEST_STATE. */
  sequence: SequenceSchema,
  /** Server time in ms; clients use it to refine their clock offset. */
  timestamp: EpochMsSchema,
  /** Room state version this message reflects (present on state-bearing messages). */
  stateVersion: z.int().nonnegative().optional(),
} as const;

const SessionGrantSchema = z.strictObject({
  sessionId: UuidSchema,
  playerId: PlayerIdSchema.nullable(),
  reconnectToken: z.string().min(16).max(128),
});

export const ENTITLEMENT_REASONS = ['GRANTED', 'RESTORED', 'LINKED', 'REVOKED', 'EXPIRED'] as const;

/**
 * Server → client event payloads. A single `PHASE_ENTERED` event carries the phase-discriminated
 * `PhaseData` (the same schema the snapshot uses), replacing the per-phase GDD §16 names:
 * COUNTDOWN/ROUND_STARTED/QUESTION_PRESENTED/QUESTION_CLOSED/REVEAL/SCORE_DELTA/SCOREBOARD/
 * FINAL_STARTED/GAME_OVER all map to `PHASE_ENTERED` with the corresponding `data.phase`.
 */
export const SERVER_PAYLOADS = {
  ROOM_JOINED: z.strictObject({ session: SessionGrantSchema, room: RoomViewSchema }),
  RECONNECTED: z.strictObject({
    session: SessionGrantSchema,
    role: z.enum(['DISPLAY', 'PLAYER']),
    room: RoomViewSchema,
  }),
  ROOM_STATE: z.strictObject({ room: RoomViewSchema }),
  PLAYER_JOINED: z.strictObject({ player: PublicPlayerSchema }),
  PLAYER_LEFT: z.strictObject({ playerId: PlayerIdSchema, reason: z.enum(['LEFT', 'KICKED']) }),
  PLAYER_STATUS: z.strictObject({
    playerId: PlayerIdSchema,
    connection: ConnectionSchema,
    ready: z.boolean(),
  }),
  LEADER_CHANGED: z.strictObject({ playerId: PlayerIdSchema.nullable() }),
  SETTINGS_CHANGED: z.strictObject({ settings: LobbySettingsSchema }),
  NICKNAME_CHANGED: z.strictObject({ playerId: PlayerIdSchema, nickname: z.string().max(64) }),
  PHASE_ENTERED: z.strictObject({
    phaseEnteredAt: EpochMsSchema,
    phaseDeadlineAt: EpochMsSchema.nullable(),
    data: PhaseDataSchema,
  }),
  ANSWER_LOCKED: z.strictObject({
    playerId: PlayerIdSchema,
    answeredCount: z.int().nonnegative(),
    eligibleCount: z.int().nonnegative(),
  }),
  ANSWER_ACCEPTED: z.strictObject({
    messageId: UuidSchema,
    questionId: QuestionIdSchema,
    optionId: OptionIdSchema,
    lockedAt: EpochMsSchema,
  }),
  ANSWER_REJECTED: z.strictObject({ messageId: UuidSchema, code: ErrorCodeSchema }),
  PLAYER_STATE: z.strictObject({ you: YouViewSchema }),
  ACK: z.strictObject({ messageId: UuidSchema }),
  ERROR: z.strictObject({
    messageId: UuidSchema.nullable(),
    code: ErrorCodeSchema,
    params: ErrorParamsSchema.optional(),
  }),
  PONG: z.strictObject({ clientSentAt: EpochMsSchema, serverTime: EpochMsSchema }),
  SESSION_REVOKED: z.strictObject({
    reason: z.enum(['KICKED', 'TOKEN_REUSE', 'ROOM_CLOSED', 'LEFT']),
  }),
  SESSION_SUPERSEDED: z.strictObject({}),
  ENTITLEMENT_CHANGED: z.strictObject({
    tier: TierSchema,
    reason: z.enum(ENTITLEMENT_REASONS),
  }),
  DISPLAY_STATUS: z.strictObject({ connected: z.boolean(), awaitingDisplay: z.boolean() }),
  ROOM_CLOSING: z.strictObject({ reason: CloseReasonSchema }),
} as const;

export type ServerMessageType = keyof typeof SERVER_PAYLOADS;
export const SERVER_MESSAGE_TYPES = Object.keys(SERVER_PAYLOADS) as ServerMessageType[];

/** An event as produced by the engine / server logic, before an envelope is attached. */
export type ServerEvent = {
  [K in ServerMessageType]: { type: K; payload: z.infer<(typeof SERVER_PAYLOADS)[K]> };
}[ServerMessageType];

export type ServerMessage = ServerEvent & {
  protocolVersion: number;
  messageId: string;
  roomId: string | null;
  sessionId: string | null;
  sequence: number;
  timestamp: number;
  stateVersion?: number;
};

const serverVariants = SERVER_MESSAGE_TYPES.map((type) =>
  z.strictObject({
    type: z.literal(type),
    ...serverEnvelopeShape,
    payload: SERVER_PAYLOADS[type],
  }),
);

export const ServerMessageSchema = z.discriminatedUnion(
  'type',
  serverVariants as unknown as [
    (typeof serverVariants)[number],
    ...(typeof serverVariants)[number][],
  ],
);

export type ServerPayload<K extends ServerMessageType> = z.infer<(typeof SERVER_PAYLOADS)[K]>;
