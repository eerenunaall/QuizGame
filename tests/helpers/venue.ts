import { randomUUID } from 'node:crypto';
import type { SessionKind } from '../../apps/realtime/src/auth/account-sessions';
import { call } from './payments';
import type { TestServer } from './server';

/** Venue mode test fixtures (ADR-0024): the flag, a venue with its people, and the staff page's API. */
export async function setVenueFlag(server: TestServer, enabled: boolean): Promise<void> {
  await server.db.db
    .updateTable('feature_flags')
    .set({ enabled })
    .where('key', '=', 'venue.sessions')
    .execute();
  server.built.flags.invalidate();
}

export interface Person {
  accountId: string;
  email: string;
  token: string;
}

/** A signed-in account (by default a browser session, as staff use the /staff page). */
export async function person(
  server: TestServer,
  label = 'person',
  kind: SessionKind = 'WEB',
): Promise<Person> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.com`;
  const account = (await server.built.accounts.signIn(email, 'tr'))!;
  const session = await server.built.accountSessions.create(account.id, kind, {
    ipHash: 'test',
    userAgentHash: null,
  });
  return { accountId: account.id, email, token: session.token };
}

export interface VenueFixture {
  venueId: string;
  owner: Person;
  staff: Person;
}

/** A venue with an owner and one member of staff, settings optionally changed. */
export async function makeVenue(
  server: TestServer,
  settings: Record<string, unknown> = {},
): Promise<VenueFixture> {
  const owner = await person(server, 'owner');
  const member = await person(server, 'staff');
  const venues = server.built.venues;
  const { id } = await venues.createVenue(`Kafe ${randomUUID().slice(0, 4)}`, owner.email, null);
  await venues.addStaff(id, member.email, 'STAFF', owner.accountId);
  if (Object.keys(settings).length > 0) await venues.updateSettings(id, settings);
  return { venueId: id, owner, staff: member };
}

/** The staff page's calls, as a bearer-token client. */
export function staffApi(server: TestServer, who: { token: string } | null, venueId: string) {
  const base = `/v1/venues/${venueId}`;
  const send = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) =>
    call<T>(server, method, path, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  return {
    me: () => send('GET', '/v1/venue/me'),
    sessions: () => send<{ items: SessionLike[]; serverTime: number }>('GET', `${base}/sessions`),
    open: (body: Record<string, unknown>) => send<SessionLike>('POST', `${base}/sessions`, body),
    extend: (id: string, minutes: number) =>
      send<SessionLike>('POST', `${base}/sessions/${id}/extend`, { minutes }),
    pause: (id: string) => send<SessionLike>('POST', `${base}/sessions/${id}/pause`, {}),
    resume: (id: string) => send<SessionLike>('POST', `${base}/sessions/${id}/resume`, {}),
    end: (id: string) => send<SessionLike>('POST', `${base}/sessions/${id}/end`, {}),
    redeem: (code: string) =>
      send<{ text?: string; winner?: string; error?: { code: string } }>(
        'POST',
        `${base}/rewards/redeem`,
        { code },
      ),
    settings: () => send('GET', `${base}/settings`),
    saveSettings: (patch: Record<string, unknown>) => send('POST', `${base}/settings`, patch),
    staff: () => send('GET', `${base}/staff`),
    invite: (email: string) => send('POST', `${base}/staff`, { email }),
    remove: (accountId: string) => send('POST', `${base}/staff/${accountId}/remove`, {}),
  };
}

export interface SessionLike {
  id: string;
  roomCode: string;
  state: 'RUNNING' | 'PAUSED' | 'ENDED';
  remainingMs: number;
  endsAt: number | null;
  purchasedMinutes: number;
  startedAt: number;
  timeUp: boolean;
  roomLive: boolean;
  error?: { code: string };
}
