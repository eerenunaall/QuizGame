import { err, ok, type Result } from '@quizparty/shared';
import {
  MAX_CLIENT_MESSAGE_BYTES,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from './constants';
import { ClientMessageSchema, type ClientMessage } from './client';
import type { ErrorCode } from './errors';
import { ServerMessageSchema, type ServerEvent, type ServerMessage } from './server';

export interface ParseFailure {
  code: Extract<ErrorCode, 'INVALID_MESSAGE' | 'UNSUPPORTED_PROTOCOL'>;
  /** Present when the offending message carried a usable id, so the server can address the ERROR. */
  messageId: string | null;
  /** Diagnostic detail for server logs only; never sent to clients. */
  detail: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // surrogate pair
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function isSupportedVersion(version: unknown): boolean {
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= MIN_SUPPORTED_PROTOCOL_VERSION &&
    version <= PROTOCOL_VERSION
  );
}

/**
 * Parses and validates one inbound client frame. Order matters: size → JSON → protocol version →
 * strict schema, so oversized payloads never reach the JSON parser and a version mismatch is
 * reported as such rather than as a generic schema error.
 */
export function parseClientMessage(raw: string): Result<ClientMessage, ParseFailure> {
  if (utf8ByteLength(raw) > MAX_CLIENT_MESSAGE_BYTES) {
    return err({ code: 'INVALID_MESSAGE', messageId: null, detail: 'message too large' });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err({ code: 'INVALID_MESSAGE', messageId: null, detail: 'not valid JSON' });
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return err({ code: 'INVALID_MESSAGE', messageId: null, detail: 'not an object' });
  }
  const record = json as Record<string, unknown>;
  const messageId =
    typeof record.messageId === 'string' && UUID_RE.test(record.messageId)
      ? record.messageId
      : null;
  if (!isSupportedVersion(record.protocolVersion)) {
    return err({ code: 'UNSUPPORTED_PROTOCOL', messageId, detail: 'unsupported protocolVersion' });
  }
  const parsed = ClientMessageSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return err({ code: 'INVALID_MESSAGE', messageId, detail });
  }
  return ok(parsed.data as ClientMessage);
}

export interface EnvelopeContext {
  messageId: string;
  roomId: string | null;
  sessionId: string | null;
  sequence: number;
  timestamp: number;
  stateVersion?: number;
}

export function buildServerMessage(event: ServerEvent, context: EnvelopeContext): ServerMessage {
  const message = {
    type: event.type,
    protocolVersion: PROTOCOL_VERSION,
    messageId: context.messageId,
    roomId: context.roomId,
    sessionId: context.sessionId,
    sequence: context.sequence,
    timestamp: context.timestamp,
    ...(context.stateVersion === undefined ? {} : { stateVersion: context.stateVersion }),
    payload: event.payload,
  };
  return message as ServerMessage;
}

/** Strict validation of an outbound message; used in dev/test/E2E and by `QP_VALIDATE_OUTBOUND`. */
export function validateServerMessage(message: unknown): Result<ServerMessage, string> {
  const parsed = ServerMessageSchema.safeParse(message);
  if (parsed.success) return ok(parsed.data as ServerMessage);
  return err(
    parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  );
}

export function parseServerMessage(raw: string): Result<ServerMessage, string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err('not valid JSON');
  }
  return validateServerMessage(json);
}
