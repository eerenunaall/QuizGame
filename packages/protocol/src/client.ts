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
  PlayModeSchema,
  QuestionIdSchema,
  QuestionReportReasonSchema,
  RiskTierSchema,
  RulesetSchema,
  SabotageKindSchema,
  SequenceSchema,
  TeamIdSchema,
  UuidSchema,
} from './common';
import { MAX_ROUNDS, MAX_STATEMENT_LENGTH, MAX_TEAMS, MIN_ROUNDS, MIN_TEAMS } from './constants';

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
   * RISK_PICK: the stake and Double Down, final once sent (ADR-0010, ADR-0022). All-or-nothing: if
   * any part is refused, nothing is spent.
   */
  COMMIT_RISK: z.strictObject({
    stake: RiskTierSchema,
    doubleDown: z.boolean(),
    /** Cover (ADR-0023): pay a fee now, a miss costs nothing. Absent = off. */
    cover: z.boolean().optional(),
    /** Pot (ADR-0023): ante into the question's pot. Absent = off. */
    pot: z.boolean().optional(),
    /** Duel (ADR-0023): challenge one rival, who may accept or decline in the same phase. */
    duel: z.strictObject({ targetId: PlayerIdSchema }).nullable().optional(),
  }),
  /**
   * RISK_PICK: the rival of a Duel challenge accepts or declines it (ADR-0023). Final per challenger;
   * an unanswered challenge counts as declined when the phase ends. Refused unless that player really
   * challenged you (`POWER_UNAVAILABLE`).
   */
  RESPOND_DUEL: z.strictObject({
    challengerId: PlayerIdSchema,
    accept: z.boolean(),
  }),
  /**
   * SABOTAGE_PICK: at most one sabotage, final once sent; `sabotage: null` confirms "no sabotage" so
   * the table does not wait for this player (ADR-0022). Refused outside SABOTAGE_PICK (`INVALID_STATE`).
   */
  COMMIT_SABOTAGE: z.strictObject({
    sabotage: z
      .strictObject({
        /** Individual play: the rival player. Exactly one of `targetId` and `targetTeamId` (ADR-0026). */
        targetId: PlayerIdSchema.optional(),
        /** Team play: the rival team; the effect lands on every active member of it. */
        targetTeamId: TeamIdSchema.optional(),
        effect: SabotageKindSchema,
        /** LOCKOUT only: the joker to block next round. */
        joker: JokerSchema.optional(),
      })
      .refine((value) => (value.targetId === undefined) !== (value.targetTeamId === undefined), {
        message: 'exactly one of targetId and targetTeamId',
      })
      .nullable(),
  }),
  /** 50/50, in ANSWERING before the player has answered. */
  USE_FIFTY_FIFTY: empty,
  /** Accessibility: disorienting sabotage effects are softened for this player (never disclosed). */
  SET_PREFERENCES: z.strictObject({ reducedEffects: z.boolean() }),
  /**
   * A player flags the question on the reveal screen. The server reports the round's own question
   * (the id is only checked against it), one report per player per question.
   */
  REPORT_QUESTION: z.strictObject({
    questionId: QuestionIdSchema,
    reason: QuestionReportReasonSchema,
  }),
  /**
   * Who Said It, lobby only: the player's one statement (a second send replaces the first). The server
   * moderates it (`sanitizeUserText`) before the engine sees it; the schema cap only bounds the frame.
   */
  SUBMIT_STATEMENT: z.strictObject({
    text: z
      .string()
      .min(1)
      .max(MAX_STATEMENT_LENGTH * 3),
  }),
  /** The TV asks for a one-time link (shown as a QR code) that attaches a phone owner's full game to this room. */
  REQUEST_UNLOCK_LINK: empty,
  LEAVE_ROOM: empty,
  REQUEST_STATE: empty,
  PING: z.strictObject({ clientSentAt: EpochMsSchema }),
  // Host commands (display session or the room leader only)
  START_GAME: empty,
  SET_SETTINGS: z.strictObject({
    rounds: z.int().min(MIN_ROUNDS).max(MAX_ROUNDS).optional(),
    difficulty: DifficultyPresetSchema.optional(),
    categories: z.union([z.literal('ALL'), z.array(CategoryIdSchema).min(1).max(24)]).optional(),
    /** ADR-0026: individual or team play, the café ruleset, and how many teams (2-4). */
    play: PlayModeSchema.optional(),
    ruleset: RulesetSchema.optional(),
    teamCount: z.int().min(MIN_TEAMS).max(MAX_TEAMS).optional(),
  }),
  /**
   * Team play, lobby or results (ADR-0026): put yourself (no `playerId`) in a team. With a `playerId` of
   * somebody else it is a host command (the display or the leader), refused with `NOT_HOST` otherwise.
   */
  ASSIGN_TEAM: z.strictObject({ teamId: TeamIdSchema, playerId: PlayerIdSchema.optional() }),
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
