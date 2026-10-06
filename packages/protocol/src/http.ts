import { z } from 'zod';
import {
  CategoryIdSchema,
  ClientInfoSchema,
  ErrorParamsSchema,
  LocaleSchema,
  TierSchema,
  UuidSchema,
} from './common';
import { ErrorCodeSchema } from './errors';

/**
 * HTTP surface shared by the realtime server and every client (ADR-0008). Responses are validated
 * in tests and, in development builds, by the client, so the two sides cannot drift.
 */

export const CreateRoomRequestSchema = z.strictObject({
  client: ClientInfoSchema,
  locale: LocaleSchema.optional(),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const CreateRoomResponseSchema = z.strictObject({
  roomId: UuidSchema,
  code: z.string().length(6),
  tier: TierSchema,
  joinUrl: z.string().max(200),
  display: z.strictObject({
    sessionId: UuidSchema,
    reconnectToken: z.string().min(16).max(128),
  }),
  maxPlayers: z.int().min(1).max(8),
});
export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>;

export const RoomPreviewSchema = z.strictObject({
  code: z.string().length(6),
  joinable: z.boolean(),
  phase: z.enum(['LOBBY', 'IN_GAME', 'FINISHED']),
  playerCount: z.int().min(0).max(8),
  maxPlayers: z.int().min(1).max(8),
});
export type RoomPreview = z.infer<typeof RoomPreviewSchema>;

export const CategoryCatalogSchema = z.strictObject({
  language: LocaleSchema,
  /** The weekly rotating free category (null when the bank has none). */
  freeCategoryId: CategoryIdSchema.nullable(),
  categories: z
    .array(
      z.strictObject({
        id: CategoryIdSchema,
        label: z.string().max(80),
        /** Active questions available in this language (never zero: empty categories are omitted). */
        questions: z.int().positive(),
        free: z.boolean(),
      }),
    )
    .max(48),
});
export type CategoryCatalog = z.infer<typeof CategoryCatalogSchema>;

export const ConfigResponseSchema = z.strictObject({
  protocolVersion: z.int().positive(),
  minProtocolVersion: z.int().positive(),
  webUrl: z.string().max(200),
  wsPath: z.string().max(40),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

export const ApiErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.union([ErrorCodeSchema, z.literal('NOT_FOUND')]),
    params: ErrorParamsSchema.optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
