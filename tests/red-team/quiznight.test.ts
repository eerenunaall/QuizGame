/* eslint-disable @typescript-eslint/no-explicit-any -- the TV and host views are inspected loosely by the tests */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanForbiddenKeys } from '@quizparty/protocol';
import type { Command } from '@quizparty/quiznight';
import { CSRF_HEADER, SESSION_COOKIE } from '../../apps/realtime/src/auth/guard';
import { staff as adminStaff } from '../helpers/admin';
import { call } from '../helpers/payments';
import { nightApi, nightConfig, tvFrame, tvFrameByToken } from '../helpers/quiznight';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, person, setVenueFlag, type VenueFixture } from '../helpers/venue';

/**
 * ATTACKS 70-79 - the host-led quiz night (ADR-0029). The tablet holds every answer; the TV, a guest or
 * another café must never see one early. Every owner route is walked as a stranger, staff, another owner
 * and a console session; the display link is forged, aged, revoked and swapped; the log is raced.
 */
let server: TestServer;
let strict: TestServer;
let a: VenueFixture;
let b: VenueFixture;
let offset = 0;
beforeAll(async () => {
  server = await startServer({
    seed: false,
    clock: { now: () => Date.now() + offset },
    env: { RATE_LIMIT_SCALE: '100' },
  });
  strict = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '1' } });
  await Promise.all([setVenueFlag(server, true), setVenueFlag(strict, true)]);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await Promise.all([server.dispose(), strict.dispose()]);
});

const next = (n: number): Command[] => Array.from({ length: n }, () => ({ type: 'NEXT' }));

async function newNight(fixture = a) {
  const api = nightApi(server, fixture.owner, fixture.venueId);
  const created = await api.create();
  expect(created.status).toBe(201);
  const id = (created.body as { night: { id: string } }).night.id;
  return { api, id };
}
async function run(api: ReturnType<typeof nightApi>, id: string, ...cmds: Command[]) {
  let last;
  for (const cmd of cmds) {
    last = await api.command(id, cmd);
    expect(last.status, JSON.stringify(last.body)).toBe(200);
  }
  if (!last) throw new Error('run needs at least one command');
  return last;
}

const quizRoutes = (s: TestServer) =>
  s.built.routes.filter((route) => route.url.includes('/quiznights'));
const fill = (url: string, venueId: string, nightId: string) =>
  url.replace(':venueId', venueId).replace(':nightId', nightId);

describe('ATTACK 70 - a stranger at the quiz master’s tablet', () => {
  it('walks every route: anonymous 401, stranger and app 404, another café’s owner 404, console 403, staff 403', async () => {
    const { id, api } = await newNight();
    const before = JSON.stringify((await api.detail(id)).body);
    const stranger = await person(server, 'stranger');
    const app = await person(server, 'app', 'MOBILE');
    const console = await adminStaff(server, ['ADMIN']);
    const routes = quizRoutes(server);
    expect(routes.length).toBe(12);
    for (const route of routes) {
      const path = fill(route.url, a.venueId, id);
      const body = route.url.endsWith('/rewards/redeem')
        ? { code: 'ABCD2345' }
        : route.method === 'POST'
          ? { cmd: { type: 'NEXT' } }
          : undefined;
      const label = `${route.method} ${route.url}`;
      const as = async (token?: string, p = path) =>
        (
          await call(server, route.method, p, {
            cookies: false,
            ...(token ? { token } : {}),
            ...(body ? { body } : {}),
          })
        ).status;
      expect({ label, status: await as() }).toEqual({ label, status: 401 });
      expect({ label, status: await as(stranger.token) }).toEqual({ label, status: 404 });
      expect({ label, status: await as(app.token) }).toEqual({ label, status: 404 });
      expect({ label, status: await as(b.owner.token) }).toEqual({ label, status: 404 });
      expect({ label, status: await as(console.token) }).toEqual({ label, status: 403 });
      const staffStatus = await as(a.staff.token);
      // staff may check a prize code at the counter, nothing else
      if (route.url.endsWith('/rewards/redeem')) expect(staffStatus).toBe(404);
      else expect({ label, status: staffStatus }).toEqual({ label, status: 403 });
    }
    expect(JSON.stringify((await api.detail(id)).body)).toBe(before);
  });

  it('refuses a TV request with no link and one with junk', async () => {
    for (const q of ['', '?l=', '?l=abc', '?l=a.b.c', `?l=${'x'.repeat(300)}`, '?x=1']) {
      const r = await call(server, 'GET', `/v1/quiznight/tv${q}`, { cookies: false });
      expect([400, 404]).toContain(r.status);
    }
  });
});

describe('ATTACK 71 - a hostile page rides the owner’s cookie', () => {
  it('refuses cookie writes without Origin and the CSRF proof', async () => {
    const { id } = await newNight();
    const cookie = `${SESSION_COOKIE}=${a.owner.token}`;
    for (const headers of [
      { cookie } as Record<string, string>,
      { cookie, origin: 'https://evil.example', [CSRF_HEADER]: '1' },
      { cookie, origin: 'http://localhost:5173' },
    ]) {
      const r = await call(server, 'POST', `/v1/venues/${a.venueId}/quiznights/${id}/command`, {
        cookies: false,
        headers,
        body: { cmd: { type: 'START' } },
      });
      expect(r.status).toBe(403);
    }
    expect((await nightApi(server, a.owner, a.venueId).state(id)).body.host.started).toBe(false);
  });
});

describe('ATTACK 72 - forged, aged, revoked and swapped display links', () => {
  it('accepts the real link and refuses every variation', async () => {
    const { id, api } = await newNight();
    const { id: other } = await newNight();
    const link = (await api.link(id)).body;
    const good = await tvFrame(server, link.url);
    expect(good.status).toBe(200);
    const token = new URL(link.url).searchParams.get('l')!;
    const [linkId, expires, sig] = token.split('.') as [string, string, string];
    const flipped = sig.replace(/^./u, sig[0] === 'a' ? 'b' : 'a');
    const otherLink = new URL((await api.link(other)).body.url).searchParams.get('l')!;
    const [, oExp, oSig] = otherLink.split('.') as [string, string, string];
    const variants = [
      `${linkId}.${expires}.${flipped}`, // forged signature
      `${linkId}.${Number(expires) + 86_400_000}.${sig}`, // extended expiry
      `${linkId}.${oExp}.${oSig}`, // swapped: this link id with another night's signature
      `00000000-0000-4000-8000-000000000000.${expires}.${sig}`, // unknown link
      `${linkId}.${expires}`,
      `${linkId}.${expires}.${sig}.extra`,
    ];
    for (const v of variants) expect((await tvFrameByToken(server, v)).status).toBe(404);
    // a link carries no foreign night: the swapped signature of night B never shows B
    expect(JSON.stringify(good.body)).not.toContain(other);
  });

  it('expires after 12 hours and stops at revocation', async () => {
    const { id, api } = await newNight();
    const first = (await api.link(id)).body;
    const second = (await api.link(id)).body;
    expect((await tvFrame(server, first.url)).status).toBe(200);
    expect((await api.revoke(id)).status).toBe(200);
    expect((await tvFrame(server, first.url)).status).toBe(404);
    expect((await tvFrame(server, second.url)).status).toBe(404);
    const fresh = (await api.link(id)).body;
    expect((await tvFrame(server, fresh.url)).status).toBe(200);
    offset += 12 * 3_600_000 + 1000;
    try {
      expect((await tvFrame(server, fresh.url)).status).toBe(404);
    } finally {
      offset -= 12 * 3_600_000 + 1000;
    }
  });

  it('rate-limits guessing and keeps working for the real link afterwards', async () => {
    const fx = await makeVenue(strict);
    const api = nightApi(strict, fx.owner, fx.venueId);
    const created = await api.create();
    const id = (created.body as { night: { id: string } }).night.id;
    const link = (await api.link(id)).body;
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++)
      statuses.push(
        (
          await tvFrameByToken(
            strict,
            `00000000-0000-4000-8000-00000000000${i % 10}.1.${'a'.repeat(64)}`,
          )
        ).status,
      );
    expect(statuses.filter((s) => s === 404).length).toBeLessThanOrEqual(12);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(8);
    // even the real link is paused for the guesser's address: that is the price of guessing
    expect((await tvFrame(strict, link.url)).status).toBe(429);
  });
});

describe('ATTACK 73 - the TV frames of a whole night never leak', () => {
  it('walks a night and scans every frame the TV could fetch', async () => {
    const { id, api } = await newNight();
    const link = (await api.link(id)).body;
    const frames: { step: string; json: string; view: any }[] = [];
    const snap = async () => {
      const r = await tvFrame(server, link.url);
      expect(r.status).toBe(200);
      const view = r.body.view;
      frames.push({ step: view.step, json: JSON.stringify(view), view });
    };
    await snap(); // before START: waiting
    await run(api, id, { type: 'START' });
    await run(api, id, { type: 'JOKER', questionId: 'a', teamId: 't2', on: true });
    await snap();
    // intro, how-to, round title, a, b, c, locked, swap
    for (let i = 0; i < 7; i++) {
      await run(api, id, { type: 'NEXT' });
      await snap();
    }
    await run(
      api,
      id,
      { type: 'MARK', questionId: 'a', teamId: 't1', right: true },
      { type: 'MARK', questionId: 'b', teamId: 't3', right: true },
      { type: 'MARK', questionId: 'c', teamId: 't2', right: false },
    );
    await snap();
    // answers a, b, c, marking, round scores, standings, round 2 title, e, locked, swap
    for (let i = 0; i < 10; i++) {
      await run(api, id, { type: 'NEXT' });
      await snap();
    }
    await run(api, id, { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't1', value: 300 });
    for (let i = 0; i < 5; i++) {
      await run(api, id, { type: 'NEXT' });
      await snap();
    }
    expect(frames.at(-1)!.step).toBe('PODIUM');
    const forbiddenWords = [
      '"marks"',
      '"counts"',
      '"estimates"',
      '"markers"',
      '"cmd"',
      '"actor"',
      'accountId',
      'config',
    ];
    const firstAnswer = frames.findIndex((f) => f.step === 'ANSWER');
    expect(firstAnswer).toBeGreaterThan(0);
    frames.forEach((f, i) => {
      // the scanner's keys are forbidden before the reveal; answer and score slides are the reveal
      if (i < firstAnswer || f.step === 'QUESTION')
        expect(scanForbiddenKeys(f.view), `frame ${i} ${f.step}`).toEqual([]);
      for (const w of forbiddenWords) expect(f.json, `frame ${i} ${f.step} ${w}`).not.toContain(w);
      // The answer text of the options (index 2 = "Uc") is revealed only on ANSWER slides; the
      // explanation texts never before their own answer slide.
      if (i < firstAnswer) {
        expect(f.view.answer, `frame ${i}`).toBeNull();
        expect(f.json).not.toContain('ACIKLAMA-');
      }
      if (f.step === 'ANSWER' && f.view.question.number === 1 && f.view.round.index === 0) {
        expect(f.json).toContain('ACIKLAMA-a');
        expect(f.json).not.toContain('ACIKLAMA-b');
        expect(f.json).not.toContain('ACIKLAMA-c');
      }
      if (f.step === 'QUESTION') expect(f.view.answer).toBeNull();
    });
    // the joker banner is on the question it was played on, nowhere earlier
    const banner = frames.filter((f) => f.view.doubled?.length);
    expect(banner).toHaveLength(1);
    expect(banner[0]!.view.question.number).toBe(1);
    // no frame before the round-scores slide shows totals
    const firstScores = frames.findIndex((f) => f.step === 'ROUND_SCORES');
    frames.slice(0, firstScores).forEach((f) => {
      expect(f.view.roundScores).toBeNull();
      expect(f.view.standings).toBeNull();
    });
    // a guest or the TV cannot see the marking grid even on the marking slide
    const marking = frames.find((f) => f.step === 'MARKING')!;
    expect(marking.view.question).toBeNull();
    expect(marking.view.roundScores).toBeNull();
  });
});

describe('ATTACK 74 - forged actors, timestamps and previous values', () => {
  it('refuses a body that names its own actor, time, sequence or previous value', async () => {
    const { id, api } = await newNight();
    await run(api, id, { type: 'START' });
    for (const extra of [{ actor: b.owner.accountId }, { at: 1 }, { seq: 7 }, { prev: true }]) {
      const r = await call(server, 'POST', `/v1/venues/${a.venueId}/quiznights/${id}/command`, {
        cookies: false,
        token: a.owner.token,
        body: { cmd: { type: 'NEXT' }, ...extra },
      });
      expect(r.status).toBe(400);
      const inner = await call(server, 'POST', `/v1/venues/${a.venueId}/quiznights/${id}/command`, {
        cookies: false,
        token: a.owner.token,
        body: { cmd: { type: 'NEXT', ...extra } },
      });
      expect(inner.status).toBe(400);
    }
    await run(api, id, ...next(7));
    await run(api, id, { type: 'MARK', questionId: 'a', teamId: 't1', right: true });
    await run(api, id, { type: 'MARK', questionId: 'a', teamId: 't1', right: false });
    const log = (await api.log(id)).body as {
      events: { seq: number; actor: string; prev: unknown; cmd: { type: string } }[];
    };
    expect(log.events.map((e) => e.seq)).toEqual(log.events.map((_, i) => i + 1));
    expect(new Set(log.events.map((e) => e.actor))).toEqual(new Set([a.owner.accountId]));
    const marks = log.events.filter((e) => e.cmd.type === 'MARK');
    expect(marks.map((e) => e.prev)).toEqual([null, true]);
  });
});

describe('ATTACK 75 - the 2x joker after the fact, or beyond the limit', () => {
  it('refuses once the question is on the TV, over the limit, and on estimate questions', async () => {
    const { id, api } = await newNight();
    await run(api, id, { type: 'START' });
    const refusal = async (cmd: Command) => {
      const r = await api.command(id, cmd);
      expect(r.status).toBe(409);
      return r.body.error?.params?.reason;
    };
    await run(api, id, { type: 'JOKER', questionId: 'a', teamId: 't1', on: true });
    await run(api, id, { type: 'JOKER', questionId: 'b', teamId: 't1', on: true });
    expect(await refusal({ type: 'JOKER', questionId: 'c', teamId: 't1', on: true })).toBe(
      'JOKER_LIMIT',
    );
    expect(await refusal({ type: 'JOKER', questionId: 'e', teamId: 't2', on: true })).toBe(
      'JOKER_NOT_ALLOWED',
    );
    expect(await refusal({ type: 'JOKER', questionId: 'zzz', teamId: 't2', on: true })).toBe(
      'UNKNOWN_REF',
    );
    await run(api, id, ...next(3)); // question a is on the TV
    expect(await refusal({ type: 'JOKER', questionId: 'a', teamId: 't2', on: true })).toBe(
      'JOKER_LOCKED',
    );
    expect(await refusal({ type: 'JOKER', questionId: 'a', teamId: 't1', on: false })).toBe(
      'JOKER_LOCKED',
    );
    // going back does not reopen it
    await run(api, id, { type: 'BACK' }, { type: 'BACK' });
    expect(await refusal({ type: 'JOKER', questionId: 'a', teamId: 't2', on: true })).toBe(
      'JOKER_LOCKED',
    );
    const host = (await api.state(id)).body.host as any;
    expect(host.rounds[0].questions[0].doubled).toEqual(['t1']);
  });
});

describe('ATTACK 76 - the prize: once, and only after the podium', () => {
  it('is refused before the podium, issued once, hashed at rest, redeemable once by staff', async () => {
    const { id, api } = await newNight();
    await run(api, id, { type: 'START' }, ...next(7));
    await run(api, id, { type: 'MARK', questionId: 'a', teamId: 't2', right: true });
    expect((await api.reward(id)).status).toBe(409);
    await run(api, id, ...next(10));
    await run(api, id, { type: 'ESTIMATE_VALUE', questionId: 'e', teamId: 't2', value: 360 });
    expect((await api.reward(id)).body.error?.params?.reason).toBe('PODIUM_NOT_REACHED');
    await run(api, id, ...next(5));
    const unknownTeam = await api.reward(id, { teamId: 't1' });
    expect(unknownTeam.status).toBe(409);
    const won = await api.reward(id);
    expect(won.status, JSON.stringify(won.body)).toBe(201);
    expect(won.body).toMatchObject({ teamName: 'Takım 2', text: 'Bedava çay' });
    const code = won.body.code!;
    expect(code).toMatch(/^[A-Z0-9]{8}$/u);
    // exactly once: a second press, from the owner, is refused and shows no code
    const again = await api.reward(id);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).not.toContain(code);
    // the code is never stored or logged in clear text
    const rows = await server.db.db.selectFrom('quiz_night_rewards').selectAll().execute();
    expect(JSON.stringify(rows)).not.toContain(code);
    // the TV and the log never carry it
    const link = (await api.link(id)).body;
    expect(JSON.stringify((await tvFrame(server, link.url)).body)).not.toContain(code);
    expect(JSON.stringify((await api.log(id)).body)).not.toContain(code);
    // the night is closed once the prize is out: no more corrections
    expect(
      (await api.command(id, { type: 'MARK', questionId: 'a', teamId: 't1', right: true })).status,
    ).toBe(409);
    // staff redeem it once; the other café cannot
    const staff = nightApi(server, a.staff, a.venueId);
    expect((await nightApi(server, b.staff, b.venueId).redeem(code)).status).toBe(404);
    const redeemed = await staff.redeem(code);
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.winner).toBe('Takım 2');
    expect((await staff.redeem(code)).status).toBe(409);
  });
});

describe('ATTACK 77 - twelve tablets pressing NEXT at once', () => {
  it('writes one ordered log: with the expected sequence only one press wins', async () => {
    const { id, api } = await newNight();
    const started = await run(api, id, { type: 'START' });
    const seq = (started.body as { seq: number }).seq;
    const results = await Promise.all(
      Array.from({ length: 12 }, () => api.command(id, { type: 'NEXT' }, seq)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(11);
    const log = (await api.log(id)).body as { events: { seq: number }[] };
    expect(log.events.map((e) => e.seq)).toEqual([1, 2]);
  });
  it('without the proof every press is applied, in order, with no gaps', async () => {
    const { id, api } = await newNight();
    await run(api, id, { type: 'START' });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => api.command(id, { type: 'NEXT' })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const log = (await api.log(id)).body as { events: { seq: number }[] };
    expect(log.events.map((e) => e.seq)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(((await api.state(id)).body.host as any).cursor).toBe(12);
  });
});

describe('ATTACK 78 - another café’s night', () => {
  it('is not found by id under either venue path, and the owner of B changes nothing of A', async () => {
    const { id, api } = await newNight();
    const bApi = nightApi(server, b.owner, b.venueId);
    for (const r of [
      await bApi.detail(id),
      await bApi.state(id),
      await bApi.command(id, { type: 'START' }),
      await bApi.link(id),
      await bApi.revoke(id),
      await bApi.remove(id),
      await bApi.saveConfig(id, nightConfig()),
      await bApi.reward(id),
      await nightApi(server, b.owner, a.venueId).detail(id),
    ])
      expect(r.status).toBe(404);
    expect((await bApi.list()).body.nights.map((n: { id: string }) => n.id)).not.toContain(id);
    expect((await api.detail(id)).status).toBe(200);
  });
});

describe('ATTACK 79 - rules that must hold while the night is live', () => {
  it('refuses to start a draft, to edit a live night, and junk configurations', async () => {
    const api = nightApi(server, a.owner, a.venueId);
    const draftConfig = nightConfig();
    draftConfig.teams = [];
    const draft = await api.create(draftConfig);
    const draftId = (draft.body as { night: { id: string; status: string } }).night;
    expect(draftId.status).toBe('DRAFT');
    expect((await api.command(draftId.id, { type: 'START' })).body.error?.params?.reason).toBe(
      'NOT_READY',
    );
    const { id } = await newNight();
    await run(api, id, { type: 'START' });
    expect((await api.saveConfig(id, nightConfig())).status).toBe(409);
    expect((await api.remove(id)).status).toBe(409);
    expect((await api.command(id, { type: 'START' })).body.error?.params?.reason).toBe(
      'ALREADY_STARTED',
    );
    for (const junk of [{}, { ...nightConfig(), extra: 1 }, { ...nightConfig(), rounds: 'x' }]) {
      const r = await api.create(junk as never);
      expect(r.status).toBe(400);
    }
    const stale = await api.command(id, { type: 'NEXT' }, 0);
    expect(stale.body.error?.params?.reason).toBe('STALE');
  });
});
