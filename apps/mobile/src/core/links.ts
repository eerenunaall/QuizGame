import { INTENT_ID_REGEX, parseInboundLink } from '@quizparty/validation';
import { parseRoomCode } from '@quizparty/shared';

export type AppLink = { kind: 'JOIN'; roomCode: string } | { kind: 'UNLOCK'; intentId: string };

export const APP_SCHEME = 'quiznight';

/**
 * Turns an inbound URL into a validated target or null (ADR-0017). Accepted:
 *  - `quiznight://join/CODE` and `quiznight://unlock/ID` (custom scheme, QR from the TV / web page),
 *  - `https://<our host>/j/CODE` (short universal link) and `/join/CODE`, `/unlock/ID`.
 * Everything else, including other hosts, extra segments, encoded characters and credentials in the
 * URL, is refused; the query string and fragment are ignored. Nothing here is a credential: a room
 * code or intent id only names a place, the server decides what the caller may do there.
 */
export function parseAppLink(input: string, webHosts: readonly string[]): AppLink | null {
  if (typeof input !== 'string' || input.length > 512) return null;
  // `URL` resolves dot segments before the shared parser sees the path, so refuse them in the raw text.
  const rawPath = (input.split(/[?#]/u)[0] ?? '').replace(/^[a-z]+:\/\//iu, '');
  if (/\/\.{1,2}(?:\/|$)|%|\\/u.test(rawPath)) return null;
  const custom = /^quiznight:\/\/(join|unlock)\/([^/?#]+)\/?(?:[?#].*)?$/iu.exec(input);
  if (custom) {
    const [, kind = '', value = ''] = custom;
    if (/%|\\/u.test(value)) return null;
    if (kind.toLowerCase() === 'join') {
      const roomCode = parseRoomCode(value);
      return roomCode ? { kind: 'JOIN', roomCode } : null;
    }
    return INTENT_ID_REGEX.test(value) ? { kind: 'UNLOCK', intentId: value } : null;
  }
  // `/j/CODE` is the short form of `/join/CODE`; validate through the shared parser.
  const normalised = input.replace(/^(https:\/\/[^/?#]+)\/j\//iu, '$1/join/');
  const link = parseInboundLink(normalised, webHosts);
  if (!link || link.kind === 'BLIND') return null; // Blind Quiz responses stay in the browser
  return link;
}

/** The in-app route for a validated link. */
export function routeFor(link: AppLink): string {
  return link.kind === 'JOIN' ? `/join/${link.roomCode}` : `/unlock/${link.intentId}`;
}

/** Validates a route parameter handed over by the router; the same rules as a link. */
export function validRoomCode(param: unknown): string | null {
  return typeof param === 'string' ? parseRoomCode(param) : null;
}
export function validIntentId(param: unknown): string | null {
  return typeof param === 'string' && INTENT_ID_REGEX.test(param) ? param : null;
}
