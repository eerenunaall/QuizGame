import { z } from 'zod';
import {
  AvatarIdSchema,
  CategoryIdSchema,
  ClientInfoSchema,
  DeviceIdSchema,
  DifficultyPresetSchema,
  EpochMsSchema,
  JokerSchema,
  NicknameSchema,
  OptionIdSchema,
  PlayerIdSchema,
  QuestionIdSchema,
  RiskTierSchema,
  SabotageKindSchema,
  SequenceSchema,
  UuidSchema,
} from './common';
import { MAX_ROUNDS, MIN_ROUNDS } from './constants';

/** Envelope fields shared by every client → server message (GDD §16, ADR-0008). */
export const clientEnvelopeShape = {
  protocolVersion: z.int().positive(),
  messageId: UuidSchema,
  roomId: UuidSchema.nullable(),
  sessionId: UuidSchema.nullable(),
  sequence: SequenceSchema,
  timestamp: EpochMsSchema,
} as const;

const empty = z.strictObject({});

/** Payload schema per client message type. `JOIN_ROOM` is the only message allowed without a session. */
export const CLIENT_PAYLOADS = {
  JOIN_ROOM: z.strictObject({
    code: z.string().min(1).max(32),
    nickname: NicknameSchema,
    avatarId: AvatarIdSchema,
    deviceId: DeviceIdSchema,
    client: ClientInfoSchema,
  }),
  RECONNECT: z.strictObject({
    reconnectToken: z.string().min(16).max(128),
    lastStateVersion: z.int().nonnegative().optional(),
    client: ClientInfoSchema,
  }),
  SET_NICKNAME: z.strictObject({ nickname: NicknameSchema }),
  READY: z.strictObject({ ready: z.boolean() }),
  SUBMIT_ANSWER: z.strictObject({
    questionId: QuestionIdSchema,
    optionId: OptionIdSchema,
    /** Diagnostic only: never used for validity or scoring (ADR-0006). */
    clientSentAt: EpochMsSchema.optional(),
  }),
  /**
   * Everything a player decides in QUESTION_PREP, committed at once and final (ADR-0010): the stake,
   * Double Down, and at most one sabotage. All-or-nothing: if any part is refused, nothing is spent.
   */
  COMMIT_PREP: z.strictObject({
    stake: RiskTierSchema,
    doubleDown: z.boolean(),
    sabotage: z
      .strictObject({
        targetId: PlayerIdSchema,
        effect: SabotageKindSchema,
        /** LOCKOUT only: the joker to block next round. */
        joker: JokerSchema.optional(),
      })
      .nullable(),
  }),
  /** 50/50, in ANSWERING before the player has answered. */
  USE_FIFTY_FIFTY: empty,
  /** Accessibility: disorienting sabotage effects are softened for this player (never disclosed). */
  SET_PREFERENCES: z.strictObject({ reducedEffects: z.boolean() }),
  LEAVE_ROOM: empty,
  REQUEST_STATE: empty,
  PING: z.strictObject({ clientSentAt: EpochMsSchema }),
  // Host commands (display session or the room leader only)
  START_GAME: empty,
  SET_SETTINGS: z.strictObject({
    rounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS).optional(),
    difficulty: DifficultyPresetSchema.optional(),
    categories: z.union([z.literal('ALL'), z.array(CategoryIdSchema).min(1).max(24)]).optional(),
  }),
  KICK_PLAYER: z.strictObject({ playerId: PlayerIdSchema }),
  TRANSFER_LEADER: z.strictObject({ playerId: PlayerIdSchema }),
  REMATCH: empty,
  BACK_TO_LOBBY: empty,
  END_ROOM: empty,
} as const;

export type ClientMessageType = keyof typeof CLIENT_PAYLOADS;
export const CLIENT_MESSAGE_TYPES = Object.keys(CLIENT_PAYLOADS) as ClientMessageType[];

/** Types that only the host (display session or leader) may send. */
export const HOST_COMMANDS: ReadonlySet<ClientMessageType> = new Set([
  'START_GAME',
  'SET_SETTINGS',
  'KICK_PLAYER',
  'TRANSFER_LEADER',
  'REMATCH',
  'BACK_TO_LOBBY',
  'END_ROOM',
]);

export type ClientMessage = {
  [K in ClientMessageType]: {
    type: K;
    protocolVersion: number;
    messageId: string;
    roomId: string | null;
    sessionId: string | null;
    sequence: number;
    timestamp: number;
    payload: z.infer<(typeof CLIENT_PAYLOADS)[K]>;
  };
}[ClientMessageType];

const clientVariants = CLIENT_MESSAGE_TYPES.map((type) =>
  z.strictObject({
    type: z.literal(type),
    ...clientEnvelopeShape,
    payload: CLIENT_PAYLOADS[type],
  }),
);

export const ClientMessageSchema = z.discriminatedUnion(
  'type',
  clientVariants as unknown as [
    (typeof clientVariants)[number],
    ...(typeof clientVariants)[number][],
  ],
);

export type ClientPayload<K extends ClientMessageType> = z.infer<(typeof CLIENT_PAYLOADS)[K]>;
