/* eslint-disable @typescript-eslint/no-explicit-any -- the TV and host views are inspected loosely by the tests */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanForbiddenKeys } from '@quizparty/protocol';
import type { Command } from '@quizparty/quiznight';
import { nightApi, nightConfig, tvFrame } from '../helpers/quiznight';
import { startServer, type TestServer } from '../helpers/server';
import { makeVenue, setVenueFlag, type VenueFixture } from '../helpers/venue';

/**
 * ATTACKS 90-92 - the paper-night rules of ADR-0031: the final wager round, the new settings and the
 * extra commands. Stakes are secret on paper until the reveal slide, the final question and its answer
 * reach the TV only on their own slides, and the server (not the tablet) enforces limits and locks.
 */
let server: TestServer;
let a: VenueFixture;
let b: VenueFixture;
beforeAll(async () => {
  server = await startServer({ seed: false, env: { RATE_LIMIT_SCALE: '100' } });
  await setVenueFlag(server, true);
  a = await makeVenue(server);
  b = await makeVenue(server);
});
afterAll(async () => {
  await server.dispose();
});

const next = (n: number): Command[] => Array.from({ length: n }, () => ({ type: 'NEXT' }));

async function newFinalNight(over = {}) {
  const api = nightApi(server, a.owner, a.venueId);
  const created = await api.create(nightConfig({ wagerCap: 5, nameBonus: 2, ...over }, true));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { api, id: (created.body as { night: { id: string } }).night.id };
}
async function run(api: ReturnType<typeof nightApi>, id: string, ...cmds: Command[]) {
  for (const cmd of cmds) {
    const r = await api.command(id, cmd);
    expect(r.status, `${cmd.type} ${JSON.stringify(r.body)}`).toBe(200);
  }
}
const reason = async (api: ReturnType<typeof nightApi>, id: string, cmd: Command) => {
  const r = await api.command(id, cmd);
  expect(r.status).toBe(409);
  return r.body.error?.params?.reason;
};

/** Plays to the final intro: INTRO..STANDINGS of two rounds, t1 holds 3 points (a, c), t2 holds 1 (b). */
async function toFinalIntro(api: ReturnType<typeof nightApi>, id: string, started = false) {
  if (!started) await run(api, id, { type: 'START' });
  await run(api, id, ...next(7));
  await run(
    api,
    id,
    { type: 'MARK', questionId: 'a', teamId: 't1', right: true },
    { type: 'MARK', questionId: 'c', teamId: 't1', right: true },
    { type: 'MARK', questionId: 'b', teamId: 't2', right: true },
  );
  await run(api, id, ...next(10));
  await run(api, id, ...next(5)); // answer e, marking, round scores, standings, final intro
}

describe('ATTACK 90 - the final question and the stakes never reach the TV early', () => {
  it('walks the final and scans every frame', async () => {
    const { api, id } = await newFinalNight();
    const link = (await api.link(id)).body;
    await toFinalIntro(api, id);
    await run(
      api,
      id,
      { type: 'WAGER', teamId: 't1', amount: 3 },
      { type: 'WAGER', teamId: 't2', amount: 1 },
    );
    const frames: { step: string; json: string; view: any }[] = [];
    const snap = async () => {
      const r = await tvFrame(server, link.url);
      expect(r.status).toBe(200);
      frames.push({ step: r.body.view.step, json: JSON.stringify(r.body.view), view: r.body.view });
    };
    await snap(); // FINAL_INTRO
    await run(api, id, { type: 'NEXT' });
    await snap(); // FINAL_QUESTION
    await run(api, id, { type: 'NEXT' });
    await snap(); // FINAL_ANSWER
    await run(
      api,
      id,
      { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true },
      { type: 'MARK', questionId: 'final-wager', teamId: 't2', right: false },
    );
    await snap(); // still FINAL_ANSWER: marks changed, nothing may show
    await run(api, id, { type: 'NEXT' });
    await snap(); // FINAL_REVEAL
    await run(api, id, { type: 'NEXT' });
    await snap(); // PODIUM
    const by = (step: string) => frames.find((f) => f.step === step)!;
    const intro = by('FINAL_INTRO');
    // category and limits are public; the question, its answer and every stake are not
    expect(intro.json).toContain('FINAL-KATEGORI');
    expect(intro.json).not.toContain('Final sorusu');
    expect(intro.json).not.toContain('ACIKLAMA-final');
    expect(intro.view.answer).toBeNull();
    expect(intro.view.final.reveal).toEqual([]);
    expect(
      (intro.view.final.limits as { teamId: string; max: number }[]).map((l) => [l.teamId, l.max]),
    ).toEqual([
      ['t1', 3],
      ['t2', 1],
      ['t3', 0],
    ]);
    const question = by('FINAL_QUESTION');
    expect(question.json).toContain('Final sorusu');
    expect(question.view.answer).toBeNull();
    expect(question.json).not.toContain('ACIKLAMA-final');
    expect(question.view.final.reveal).toEqual([]);
    const answers = frames.filter((f) => f.step === 'FINAL_ANSWER');
    expect(answers[0]!.view.answer).toMatchObject({ type: 'OPTION', index: 1 });
    for (const f of answers) expect(f.view.final.reveal).toEqual([]);
    // stakes and results appear on the reveal slide, last place first, never on earlier ones
    const reveal = by('FINAL_REVEAL').view.final.reveal;
    expect((reveal as { teamId: string }[]).map((r) => r.teamId)).toEqual(['t3', 't2', 't1']);
    expect(reveal.find((r: any) => r.teamId === 't1')).toMatchObject({
      wager: 3,
      right: true,
      delta: 3,
    });
    for (const f of frames.filter((x) => x.step !== 'FINAL_REVEAL'))
      expect(f.view.final?.reveal ?? []).toEqual([]);
    // the keys the scanner forbids are absent before the reveal, and raw state never leaks
    for (const f of [intro, question]) expect(scanForbiddenKeys(f.view)).toEqual([]);
    for (const f of frames)
      for (const w of ['"wagers"', '"marks"', '"bonusTeams"', '"cmd"', '"actor"', 'config'])
        expect(f.json, `${f.step} ${w}`).not.toContain(w);
    // totals include the final only once the reveal slide is on screen
    const podium = by('PODIUM').view.podium;
    expect(podium[0]).toMatchObject({ teamId: 't1', total: 6 });
  });

  it('a TV on the last standings (after BACK) does not show the final result yet', async () => {
    const { api, id } = await newFinalNight();
    const link = (await api.link(id)).body;
    await toFinalIntro(api, id);
    await run(api, id, { type: 'WAGER', teamId: 't1', amount: 3 }, ...next(2));
    await run(api, id, { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true });
    await run(api, id, { type: 'BACK' }, { type: 'BACK' }, { type: 'BACK' });
    await run(api, id, { type: 'SHOW_STANDINGS' });
    const view = (await tvFrame(server, link.url)).body.view;
    expect(view.standings.find((r: any) => r.teamId === 't1').total).toBe(3);
  });
});

describe('ATTACK 91 - stakes: limits, locks, other cafés', () => {
  it('the server refuses early, too high, late, unknown and final-less commands', async () => {
    const { api, id } = await newFinalNight();
    await run(api, id, { type: 'START' });
    expect(await reason(api, id, { type: 'WAGER', teamId: 't1', amount: 1 })).toBe('MARK_NOT_OPEN');
    await toFinalIntro(api, id, true);
    // t1 holds 3 and the cap is 5 -> 3; t2 holds 1; t3 holds 0
    expect(await reason(api, id, { type: 'WAGER', teamId: 't1', amount: 4 })).toBe(
      'WAGER_TOO_HIGH',
    );
    expect(await reason(api, id, { type: 'WAGER', teamId: 't3', amount: 1 })).toBe(
      'WAGER_TOO_HIGH',
    );
    expect(await reason(api, id, { type: 'WAGER', teamId: 'zzz', amount: 0 })).toBe('UNKNOWN_REF');
    await run(api, id, { type: 'WAGER', teamId: 't1', amount: 3 });
    // marks open only after the answer slide
    expect(
      await reason(api, id, { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true }),
    ).toBe('MARK_NOT_OPEN');
    await run(api, id, { type: 'NEXT' }); // question on the TV: stakes are locked for good
    expect(await reason(api, id, { type: 'WAGER', teamId: 't1', amount: 1 })).toBe('WAGER_LOCKED');
    await run(api, id, { type: 'BACK' });
    expect(await reason(api, id, { type: 'WAGER', teamId: 't2', amount: 1 })).toBe('WAGER_LOCKED');
    // junk amounts never get past the schema
    for (const amount of [-1, 51, 1.5, '3', null, Number.NaN]) {
      const r = await api.command(id, { type: 'WAGER', teamId: 't1', amount });
      expect(r.status).toBe(400);
    }
    // a night without a final refuses the commands
    const plain = nightApi(server, a.owner, a.venueId);
    const created = await plain.create(nightConfig());
    const plainId = (created.body as { night: { id: string } }).night.id;
    await run(plain, plainId, { type: 'START' });
    expect(await reason(plain, plainId, { type: 'WAGER', teamId: 't1', amount: 0 })).toBe(
      'NO_FINAL',
    );
    expect(
      await reason(plain, plainId, {
        type: 'MARK',
        questionId: 'final-wager',
        teamId: 't1',
        right: true,
      }),
    ).toBe('NO_FINAL');
    expect(await reason(plain, plainId, { type: 'TEAM_NAME_BONUS', teamId: 't1', on: true })).toBe(
      'BONUS_OFF',
    );
  });

  it('another café’s owner cannot stake, mark or give bonuses on this night', async () => {
    const { api, id } = await newFinalNight();
    await toFinalIntro(api, id);
    const other = nightApi(server, b.owner, b.venueId);
    for (const cmd of [
      { type: 'WAGER', teamId: 't1', amount: 1 },
      { type: 'MARK', questionId: 'final-wager', teamId: 't1', right: true },
      { type: 'TEAM_NAME_BONUS', teamId: 't1', on: true },
    ] as Command[])
      expect((await other.command(id, cmd)).status).toBe(404);
    const host = (await api.state(id)).body.host as any;
    expect(host.final.teams.find((t: any) => t.teamId === 't1').wager).toBeNull();
    expect(host.nameBonus.teamIds).toEqual([]);
  });

  it('a stake is recorded with who set it and what it replaced', async () => {
    const { api, id } = await newFinalNight();
    await toFinalIntro(api, id);
    await run(
      api,
      id,
      { type: 'WAGER', teamId: 't1', amount: 2 },
      { type: 'WAGER', teamId: 't1', amount: 3 },
    );
    const log = (await api.log(id)).body.events as { cmd: Command; prev: unknown; actor: string }[];
    const stakes = log.filter((e) => e.cmd.type === 'WAGER');
    expect(stakes.map((e) => e.prev)).toEqual([null, 2]);
    expect(stakes.every((e) => e.actor.length > 0)).toBe(true);
  });
});

describe('ATTACK 92 - the new settings and fields are validated', () => {
  it('refuses out-of-range and unknown values, and still accepts a night saved before them', async () => {
    const api = nightApi(server, a.owner, a.venueId);
    const bad: Record<string, unknown>[] = [
      { jokerFromRound: 0 },
      { jokerFromRound: 13 },
      { nameBonus: -1 },
      { nameBonus: 11 },
      { wagerCap: 0 },
      { wagerCap: 51 },
      { estimateTop3: 'yes' },
      { consolationText: 'x'.repeat(161) },
      { unknownRule: true },
    ];
    for (const over of bad) {
      const r = await api.create(nightConfig(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
    }
    const noFinalFields = nightConfig();
    expect(
      Object.keys(noFinalFields.settings).some((k) =>
        ['jokerFromRound', 'nameBonus', 'wagerCap', 'estimateTop3', 'consolationText'].includes(k),
      ),
    ).toBe(false);
    expect((await api.create(noFinalFields)).status).toBe(201);
    const junkFinal = nightConfig({}, true);
    (junkFinal.finalWager as any).extra = 1;
    expect((await api.create(junkFinal)).status).toBe(400);
    const numberFinal = nightConfig({}, true);
    numberFinal.finalWager!.question.answer = { type: 'NUMBER', value: 3 };
    const created = await api.create(numberFinal);
    expect((created.body as any).night.status).toBe('DRAFT');
    expect(
      ((created.body as any).night.issues as { issue: string }[]).map((i) => i.issue),
    ).toContain('FINAL_NEEDS_PLAIN_ANSWER');
  });

  it('the host tablet is told the rules it needs and nothing a guest could use', async () => {
    const { api, id } = await newFinalNight({ jokerFromRound: 2, estimateTop3: true });
    await run(api, id, { type: 'START' });
    expect(await reason(api, id, { type: 'JOKER', questionId: 'a', teamId: 't1', on: true })).toBe(
      'JOKER_NOT_ALLOWED',
    );
    await run(api, id, { type: 'TEAM_NAME_BONUS', teamId: 't2', on: true });
    const host = (await api.state(id)).body.host as any;
    expect(host.nameBonus).toEqual({ points: 2, teamIds: ['t2'] });
    expect(host.rounds[0].result.points.t2).toBe(2);
  });
});
