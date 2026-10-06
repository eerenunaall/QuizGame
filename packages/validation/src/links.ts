import { parseRoomCode } from '@quizparty/shared';

/** Parameter validators for deep links, QR payloads and route params (ADR-0017). */
export const INTENT_ID_REGEX = /^[A-Za-z0-9_-]{22}$/; // 128-bit base64url
export const INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/; // 256-bit base64url

interface ParsedUrl {
  protocol: string;
  username: string;
  password: string;
  host: string;
  pathname: string;
}

/** `URL` exists in every target runtime (browsers, Node, Hermes); typed locally to avoid DOM/Node lib clashes. */
const UrlCtor = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

export type InboundLink =
  | { kind: 'JOIN'; roomCode: string }
  | { kind: 'UNLOCK'; intentId: string }
  | { kind: 'BLIND'; inviteToken: string };

/**
 * Parses an inbound https link into a typed, validated target or null. Only https, only the allowed
 * hosts, no credentials/port tricks, exact path shapes; query and fragment are ignored so nothing
 * attacker-controlled flows into the app beyond one validated identifier.
 */
export function parseInboundLink(
  input: string,
  allowedHosts: readonly string[],
): InboundLink | null {
  if (typeof input !== 'string' || input.length > 512) return null;
  let url: ParsedUrl;
  try {
    url = new UrlCtor(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  if (!allowedHosts.includes(url.host.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter((part, index) => index > 0 || part !== '');
  if (parts.length !== 2) return null;
  const [kind, value] = parts as [string, string];
  if (/%|\\|\.\./u.test(url.pathname)) return null;
  if (kind === 'join') {
    const roomCode = parseRoomCode(value);
    return roomCode ? { kind: 'JOIN', roomCode } : null;
  }
  if (kind === 'unlock')
    return INTENT_ID_REGEX.test(value) ? { kind: 'UNLOCK', intentId: value } : null;
  if (kind === 'blind')
    return INVITE_TOKEN_REGEX.test(value) ? { kind: 'BLIND', inviteToken: value } : null;
  return null;
}
