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

// ───────────── venue question sets (ADR-0025) ─────────────

/* eslint-disable @typescript-eslint/no-explicit-any -- the reports are inspected loosely by the tests */

export const toBase64 = (text: string | Uint8Array): string =>
  Buffer.from(typeof text === 'string' ? text : text).toString('base64');

/** The owner's question-set calls, as a bearer-token client. */
export function contentApi(server: TestServer, who: { token: string } | null, venueId: string) {
  const base = `/v1/venues/${venueId}/questions`;
  const send = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) =>
    call<T>(server, method, path, {
      cookies: false,
      ...(who ? { token: who.token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  const upload = (path: string, file: string | Uint8Array, fileName = 'sorular.csv') =>
    send<any>('POST', `${base}/${path}`, { fileName, data: toBase64(file) });
  return {
    list: () => send<any>('GET', base),
    dryRun: (file: string | Uint8Array, fileName?: string) => upload('dry-run', file, fileName),
    import: (file: string | Uint8Array, fileName?: string) => upload('import', file, fileName),
    retire: (uploadId: string) => send<any>('POST', `${base}/uploads/${uploadId}/retire`, {}),
    reports: () => send<any>('GET', `${base}/reports`),
    resolve: (reportId: string, action: 'DISMISS' | 'RETIRE') =>
      send<any>('POST', `${base}/reports/${reportId}/resolve`, { action }),
    prompt: (format = 'csv') => send<any>('GET', `${base}/prompt?format=${format}`),
    raw: async (path: string) => {
      const response = await fetch(`${server.httpUrl}${base}/${path}`, {
        headers: who ? { authorization: `Bearer ${who.token}` } : {},
      });
      return { status: response.status, headers: response.headers, text: await response.text() };
    },
  };
}

/** Inserts ACTIVE venue-owned questions straight into the database (for deck and isolation tests). */
export async function seedVenueQuestions(
  server: TestServer,
  venueId: string,
  count: number,
  options: { category?: string; label?: string; prefix?: string } = {},
): Promise<string[]> {
  const db = server.db.db;
  const category = options.category ?? `v${venueId.replace(/-/gu, '').slice(0, 8)}-ozel`;
  await db
    .insertInto('categories')
    .values({
      id: category,
      label_tr: options.label ?? 'Özel',
      label_en: options.label ?? 'Özel',
      free_rotation: false,
      source_required: false,
      owner_venue_id: venueId,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const ids: string[] = [];
  const prefix = options.prefix ?? 'Kafe';
  for (let i = 0; i < count; i++) {
    const text = `${prefix} sorusu ${i + 1} için doğru cevap hangisidir?`;
    const q = await db
      .insertInto('questions')
      .values({
        language: 'tr',
        category_id: category,
        difficulty: (['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const)[i % 4]!,
        text,
        status: 'DRAFT',
        author_type: 'AI_ASSISTED',
        pool: 'VENUE',
        owner_venue_id: venueId,
        lexical_fingerprint: `${venueId}:${prefix}:${i}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('question_options')
      .values(
        [0, 1, 2, 3].map((position) => ({
          question_id: q.id,
          position,
          text: `${prefix} ${i + 1} şık ${position + 1}`,
          is_correct: position === i % 4,
        })),
      )
      .execute();
    const { revision } = await db
      .selectFrom('questions')
      .select('revision')
      .where('id', '=', q.id)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('question_audits')
      .values({
        question_id: q.id,
        question_revision: revision,
        pass: 'HEURISTIC',
        provider: 'heuristics@1',
        status: 'PASS',
      })
      .execute();
    await db.updateTable('questions').set({ status: 'ACTIVE' }).where('id', '=', q.id).execute();
    ids.push(q.id);
  }
  return ids;
}

/** An open metered table row for a (fake) room id, enough for the deck builder to see a venue. */
export async function attachRoom(
  server: TestServer,
  venueId: string,
  roomId: string,
): Promise<void> {
  await server.db.db
    .insertInto('venue_sessions')
    .values({
      venue_id: venueId,
      room_id: roomId,
      room_code: 'ABCDEF',
      purchased_seconds: 3600,
      started_at: new Date(),
    })
    .execute();
}
