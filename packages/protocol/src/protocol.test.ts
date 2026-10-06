import { describe, expect, it } from 'vitest';
import {
  CLIENT_MESSAGE_TYPES,
  HOST_COMMANDS,
  MAX_CLIENT_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  buildServerMessage,
  parseClientMessage,
  parseServerMessage,
  scanForbiddenKeys,
  validateServerMessage,
} from './index';

const uuid = '3f2b8c1e-5d4a-4e8b-9c1d-0a1b2c3d4e5f';

function clientFrame(
  type: string,
  payload: unknown,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type,
    protocolVersion: PROTOCOL_VERSION,
    messageId: uuid,
    roomId: uuid,
    sessionId: uuid,
    sequence: 1,
    timestamp: 1_700_000_000_000,
    payload,
    ...overrides,
  });
}

describe('parseClientMessage', () => {
  it('accepts a well-formed answer', () => {
    const result = parseClientMessage(
      clientFrame('SUBMIT_ANSWER', { questionId: 'q1', optionId: 'abcDEF12' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe('SUBMIT_ANSWER');
  });

  it('rejects unknown fields (strict) so clients cannot smuggle data', () => {
    const result = parseClientMessage(
      clientFrame('SUBMIT_ANSWER', { questionId: 'q1', optionId: 'abcDEF12', score: 9999 }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects unknown message types and top-level extras', () => {
    expect(parseClientMessage(clientFrame('SET_SCORE', { score: 1 })).ok).toBe(false);
    expect(parseClientMessage(clientFrame('READY', { ready: true }, { isAdmin: true })).ok).toBe(
      false,
    );
  });

  it('reports unsupported protocol versions distinctly and keeps the message id', () => {
    const result = parseClientMessage(
      clientFrame('READY', { ready: true }, { protocolVersion: 99 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_PROTOCOL');
      expect(result.error.messageId).toBe(uuid);
    }
  });

  it('rejects oversized, malformed and non-object frames before schema parsing', () => {
    const big = clientFrame('SET_NICKNAME', { nickname: 'x'.repeat(MAX_CLIENT_MESSAGE_BYTES) });
    expect(parseClientMessage(big)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_MESSAGE' },
    });
    expect(parseClientMessage('{nope')).toMatchObject({ ok: false });
    expect(parseClientMessage('[1,2]')).toMatchObject({ ok: false });
    expect(parseClientMessage('null')).toMatchObject({ ok: false });
  });

  it('rejects negative, fractional and unsafe sequence numbers', () => {
    for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(parseClientMessage(clientFrame('READY', { ready: true }, { sequence })).ok).toBe(
        false,
      );
    }
  });

  it('every host command is a known client message type', () => {
    for (const type of HOST_COMMANDS) expect(CLIENT_MESSAGE_TYPES).toContain(type);
  });

  it('exposes no message type that could set score, timer or correctness', () => {
    for (const type of CLIENT_MESSAGE_TYPES) {
      expect(type).not.toMatch(/SCORE|TIMER|CORRECT|REVEAL|DEADLINE|ENTITLE/);
    }
  });
});

describe('server messages', () => {
  const event = { type: 'ACK', payload: { messageId: uuid } } as const;
  const context = { messageId: uuid, roomId: uuid, sessionId: uuid, sequence: 4, timestamp: 1 };

  it('round-trips through build → JSON → parse', () => {
    const message = buildServerMessage(event, context);
    const parsed = parseServerMessage(JSON.stringify(message));
    expect(parsed.ok).toBe(true);
  });

  it('refuses payloads with extra keys (outbound guard)', () => {
    const message = buildServerMessage(event, context);
    const tampered = { ...message, payload: { ...message.payload, correctOptionId: 'x' } };
    expect(validateServerMessage(tampered).ok).toBe(false);
  });

  it('refuses a REVEAL-shaped payload smuggled into a different message type', () => {
    const bad = buildServerMessage(
      { type: 'ANSWER_LOCKED', payload: { playerId: 'p', answeredCount: 1, eligibleCount: 2 } },
      context,
    );
    expect(validateServerMessage({ ...bad, payload: { ...bad.payload, isCorrect: true } }).ok).toBe(
      false,
    );
  });
});

describe('scanForbiddenKeys', () => {
  it('finds forbidden keys at any depth with their paths', () => {
    const hits = scanForbiddenKeys({
      a: [{ ok: 1 }, { nested: { correctOptionId: 'x' } }],
      explanation: 'leak',
    });
    expect(hits.map((h) => h.path).sort()).toEqual(['a[1].nested.correctOptionId', 'explanation']);
  });

  it('passes clean payloads', () => {
    expect(scanForbiddenKeys({ options: [{ optionId: 'abc', text: 'Ankara' }] })).toEqual([]);
  });
});
