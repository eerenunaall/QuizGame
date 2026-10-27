import { describe, expect, it } from 'vitest';
import { SABOTAGE_KINDS, type ServerEvent } from '@quizparty/protocol';
import {
  DEFAULT_GAME_CONFIG,
  applyRuleset,
  mergedPrep,
  resolveGameConfig,
  simpleRules,
  withSimpleAnswerSeconds,
} from './config';
import { createRoom, reduce } from './reducer';
import type { Audience } from './types';
import { Harness, TEST_ROOM_ID, testConfig } from './testing';
import {
  commitRisk,
  hitPlayer,
  hitTeam,
  lobby,
  pass,
  playRound,
  refusal,
  set,
  teamGame,
  toRound,
} from './teams.helpers';

/**
 * ADR-0026 §3: the café ruleset. A smaller set of powers, a 30 s window, and one short prep phase that is
 * skipped when nobody has anything to use. Everything is the same engine; the full ruleset is untouched.
 */
describe('applyRuleset', () => {
  const full = resolveGameConfig();
  const simple = applyRuleset(full, 'SIMPLE');

  it('leaves the full ruleset exactly as it is', () => {
    expect(applyRuleset(full, 'FULL')).toBe(full);
    expect(full.ruleset).toBeUndefined();
    expect(mergedPrep(full)).toBe(false);
  });

  it('is a valid game config and never touches its input', () => {
    const before = JSON.stringify(full);
    expect(() => resolveGameConfig(simple)).not.toThrow();
    expect(JSON.stringify(full)).toBe(before);
    expect(simple.ruleset).toBe('SIMPLE');
    expect(simple.version).toBe(full.version + 1000);
    expect(mergedPrep(simple)).toBe(true);
  });

  it('gives the ordinary kinds 30 s and keeps SPEED at 12 s and FINAL at 20 s', () => {
    expect(simple.timings.answerMs).toEqual({
      STANDARD: 30_000,
      SPEED: 12_000,
      RISK: 30_000,
      CROWD: 30_000,
      FINAL: 20_000,
    });
    // The read phase before the options unlock is not part of the ruleset: it is the full game's.
    expect(simple.timings.readBaseMs).toBe(full.timings.readBaseMs);
    expect(simple.timings.readMinMs).toBe(full.timings.readMinMs);
  });

  it('takes the stakes away (a safe rung only) and with them Cover, Duel and Pot', () => {
    for (const kind of ['STANDARD', 'SPEED', 'RISK', 'CROWD', 'FINAL'] as const)
      expect(Object.keys(simple.scoring.ladders[kind])).toEqual(['SAFE']);
    expect(simple.powers.cover?.enabled).toBe(false);
    expect(simple.powers.duel?.enabled).toBe(false);
    expect(simple.powers.pot?.enabled).toBe(false);
    expect(simple.powers.stakeCap?.enabled).toBe(false);
    expect(simple.director.maxRiskRounds).toBe(0);
  });

  it('keeps 50/50, Double Down and a shield, and three sabotages: Time Cut, Shuffle, Blind Clock', () => {
    expect(simple.powers.fiftyFiftyPerGame).toBe(1);
    expect(simple.powers.doubleDownPerGame).toBe(2);
    expect(simple.powers.shieldPerGame).toBe(1);
    expect(simple.powers.sabotageKinds).toEqual(['JAM', 'BLIND_CLOCK', 'SHUFFLE']);
    // a Time Cut a table feels: 6 s of a 30 s window, never more than a fifth
    expect(simple.powers.sabotage.jamMs).toBe(6_000);
    expect(simple.powers.sabotage.jamMaxPermille).toBe(200);
  });

  it('can be tuned by a venue through the same override path as everything else', () => {
    const tuned = resolveGameConfig({
      simple: { answerMs: { STANDARD: 20_000 }, sabotage: { kinds: ['JAM'], jamMs: 3_000 } },
    });
    const applied = applyRuleset(tuned, 'SIMPLE');
    expect(applied.timings.answerMs.STANDARD).toBe(20_000);
    expect(applied.timings.answerMs.CROWD).toBe(30_000);
    expect(applied.powers.sabotageKinds).toEqual(['JAM']);
    expect(applied.powers.sabotage.jamMs).toBe(3_000);
    expect(() => resolveGameConfig({ simple: { answerMs: { STANDARD: 500 } } })).toThrow();
    expect(() => resolveGameConfig({ simple: { sabotage: { kinds: [] } } })).toThrow();
  });

  it('reads the defaults for a config stored before the ruleset existed', () => {
    const old = { ...full } as Partial<typeof full>;
    delete old.simple;
    expect(simpleRules(old as typeof full)).toEqual(DEFAULT_GAME_CONFIG.simple);
  });

  it('sets the café window for the three ordinary kinds from a venue’s seconds', () => {
    const config = withSimpleAnswerSeconds(full, 45);
    const applied = applyRuleset(config, 'SIMPLE');
    expect(applied.timings.answerMs).toMatchObject({
      STANDARD: 45_000,
      RISK: 45_000,
      CROWD: 45_000,
    });
    expect(applied.timings.answerMs.SPEED).toBe(12_000);
    expect(applied.timings.answerMs.FINAL).toBe(20_000);
  });
});

describe('playing the simple ruleset', () => {
  it('keeps the room’s full config aside and restores it for the next game', () => {
    const { h, ids } = lobby(3, { ruleset: 'SIMPLE' });
    const base = h.state.config;
    h.start();
    expect(h.state.config.ruleset).toBe('SIMPLE');
    expect(h.state.baseConfig).toEqual(base);
    h.runUntil('RESULTS');
    set(h, { ruleset: 'FULL' });
    h.command(h.actor(ids[0]!), { type: 'REMATCH', payload: {} });
    expect(h.state.config).toEqual(base);
    expect(h.state.baseConfig).toBeUndefined();
  });

  it('gives every question the window of its kind, and plans no RISK round', () => {
    const { h } = lobby(3, { ruleset: 'SIMPLE', rounds: 10 });
    h.start();
    const seen = new Set<string>();
    for (let guard = 0; guard < 400 && h.state.phase !== 'RESULTS'; guard++) {
      const round = h.state.game?.round;
      if (round) {
        seen.add(round.kind);
        expect(round.answerMs).toBe(
          { STANDARD: 30_000, SPEED: 12_000, RISK: 30_000, CROWD: 30_000, FINAL: 20_000 }[
            round.kind
          ],
        );
      }
      if (!h.step()) break;
    }
    expect(seen.has('RISK')).toBe(false);
    expect(seen.has('STANDARD')).toBe(true);
    expect(seen.has('FINAL')).toBe(true);
  });

  it('never runs the old two-phase flow: RISK_PICK is the one prep phase', () => {
    const { h } = lobby(3, { ruleset: 'SIMPLE', rounds: 8 });
    h.start();
    h.runUntil('RESULTS');
    expect(h.phaseEvents()).not.toContain('SABOTAGE_PICK');
    expect(h.phaseEvents()).toContain('RISK_PICK');
  });

  it('has no stakes: a rung above safe is refused, and Cover, Duel and Pot are not on offer', () => {
    const { h, ids } = lobby(3, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('RISK_PICK');
    const risk = (payload: object) =>
      h.command(h.actor(ids[0]!), {
        type: 'COMMIT_RISK',
        payload: { stake: 'SAFE', doubleDown: false, ...payload } as never,
      });
    expect(refusal(risk({ stake: 'RISK' }))).toBe('STAKE_INVALID');
    expect(refusal(risk({ cover: true }))).toBe('POWER_UNAVAILABLE');
    expect(refusal(risk({ pot: true }))).toBe('POWER_UNAVAILABLE');
    expect(refusal(risk({ duel: { targetId: ids[1]! } }))).toBe('POWER_UNAVAILABLE');
    expect(refusal(risk({}))).toBe('OK');
  });
});

describe('the single prep phase', () => {
  it('is entered when somebody holds a Double Down, with the menu on it and the time of the ruleset', () => {
    const { h } = lobby(3, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('RISK_PICK');
    const data = h.view({ role: 'DISPLAY' }).phaseData;
    if (data.phase !== 'RISK_PICK') throw new Error('not RISK_PICK');
    expect(data.combined).toBe(true);
    expect(data.offered).toEqual(['JAM', 'SHUFFLE', 'BLIND_CLOCK']);
    expect(data.riskLadder).toHaveLength(1);
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(10_000);
  });

  it('is skipped altogether when nobody has anything to use', () => {
    const { h } = lobby(
      3,
      { ruleset: 'SIMPLE' },
      { simple: { doubleDownPerGame: 0, sabotage: { startTokens: 0 } } },
    );
    h.start();
    h.runUntil('RESULTS');
    expect(h.phaseEvents()).not.toContain('RISK_PICK');
    expect(h.phaseEvents()).not.toContain('SABOTAGE_PICK');
  });

  it('opens sabotage only from the second question, as the ruleset says', () => {
    const { h, ids } = lobby(3, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('RISK_PICK');
    expect(refusal(hitPlayer(h, ids[0]!, ids[1]!))).toBe('POWER_UNAVAILABLE'); // round 0
    toRound(h, ids, 1);
    expect(h.state.phase).toBe('RISK_PICK');
    expect(refusal(hitPlayer(h, ids[0]!, ids[1]!))).toBe('OK');
  });

  it('waits only for players who can act, and ends the moment they have all decided', () => {
    // A single token on the table, no Double Down: only its holder is waited for.
    const { h, ids } = lobby(
      3,
      { ruleset: 'SIMPLE' },
      { simple: { doubleDownPerGame: 0, sabotage: { startTokens: 0, earnAtStreaks: [1] } } },
    );
    h.start();
    toRound(h, ids, 1, { [ids[1]!]: 'wrong', [ids[2]!]: 'wrong' }); // only p1 earns a token
    expect(h.state.phase).toBe('RISK_PICK');
    expect(h.state.game!.players[ids[0]!]!.powers.tokens).toBe(1);
    // the others have nothing to decide and are not waited for
    expect(refusal(pass(h, ids[0]!))).toBe('OK');
    expect(h.state.phase).toBe('QUESTION');
  });

  it('needs a Double Down holder to answer yes or no, then ends', () => {
    const { h, ids } = lobby(
      3,
      { ruleset: 'SIMPLE' },
      { simple: { sabotage: { startTokens: 0, earnAtStreaks: [] } } },
    );
    h.start();
    h.runUntil('RISK_PICK');
    expect(refusal(commitRisk(h, ids[0]!))).toBe('OK');
    expect(refusal(commitRisk(h, ids[1]!, true))).toBe('OK');
    expect(h.state.phase).toBe('RISK_PICK');
    expect(refusal(commitRisk(h, ids[2]!))).toBe('OK');
    expect(h.state.phase).toBe('QUESTION');
  });

  it('asks a player with both a Double Down and a token to decide both', () => {
    const { h, ids } = lobby(
      2,
      { ruleset: 'SIMPLE' },
      { simple: { sabotage: { firstRoundIndex: 0 } } },
    );
    h.start();
    h.runUntil('RISK_PICK');
    commitRisk(h, ids[0]!);
    commitRisk(h, ids[1]!);
    expect(h.state.phase).toBe('RISK_PICK'); // sabotage still undecided
    pass(h, ids[0]!);
    expect(h.state.phase).toBe('RISK_PICK');
    pass(h, ids[1]!);
    expect(h.state.phase).toBe('QUESTION');
  });

  it('runs out by its own timer when somebody never answers', () => {
    const { h } = lobby(3, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('RISK_PICK');
    h.runUntil('QUESTION');
    expect(h.state.phase).toBe('QUESTION');
  });

  it('stops waiting when the phone it waits for drops', () => {
    const { h, ids } = lobby(2, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('RISK_PICK');
    commitRisk(h, ids[0]!);
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[1]!, connected: false });
    expect(h.state.phase).toBe('QUESTION');
  });

  it('shows counts only: how many decided, out of everybody online, never who or who could', () => {
    const { h, ids } = lobby(3, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('RISK_PICK');
    const events: ServerEvent[] = [];
    const mark = h.effects.length;
    commitRisk(h, ids[0]!, true);
    for (const effect of h.effects.slice(mark))
      if (effect.kind === 'emit') events.push(effect.event);
    const progress = events.find((e) => e.type === 'PREP_PROGRESS');
    expect(progress).toEqual({
      type: 'PREP_PROGRESS',
      payload: { committedCount: 1, eligibleCount: 3 },
    });
    expect(JSON.stringify(events.filter((e) => e.type !== 'PLAYER_STATE'))).not.toContain(ids[0]!);
  });

  it('tells each phone whether it can sabotage, in the prep phase too', () => {
    const { h, ids } = lobby(
      3,
      { ruleset: 'SIMPLE' },
      { simple: { sabotage: { firstRoundIndex: 0 } } },
    );
    h.start();
    h.runUntil('RISK_PICK');
    expect(h.view({ role: 'PLAYER', playerId: ids[0]! }).you!.sabotage).toEqual({
      ready: true,
      decided: false,
    });
  });
});

describe('what each phone is told in the prep phase', () => {
  it('says whether the Double Down is still to decide, and when it was', () => {
    const { h, ids } = lobby(2, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('RISK_PICK');
    const risk = (id: string) => h.view({ role: 'PLAYER', playerId: id }).you!.risk;
    expect(risk(ids[0]!)).toEqual({ ready: true, decided: false });
    commitRisk(h, ids[0]!, false);
    expect(risk(ids[0]!)).toEqual({ ready: true, decided: true }); // still holds one, but answered
    expect(risk(ids[1]!)).toEqual({ ready: true, decided: false });
    h.runUntil('QUESTION');
    expect(risk(ids[0]!)).toBeUndefined(); // the prep phase is over
  });

  it('is nothing at all in the full ruleset', () => {
    const { h, ids } = lobby(2);
    h.start();
    h.runUntil('RISK_PICK');
    expect(h.view({ role: 'PLAYER', playerId: ids[0]! }).you!.risk).toBeUndefined();
  });

  it('carries the imbalance the host may rely on in team play only', () => {
    const solo = lobby(3);
    expect(solo.h.view({ role: 'DISPLAY' }).limits).toEqual({ maxRounds: 20 });
    const teams = lobby(3, { play: 'TEAMS' }, { teams: { maxImbalance: 2 } });
    expect(teams.h.view({ role: 'DISPLAY' }).limits).toEqual({ maxRounds: 20, teamImbalance: 2 });
  });
});

describe('the café sabotages', () => {
  const sabotageGame = (override: unknown = {}, players = 3) => {
    const { h, ids } = lobby(
      players,
      { ruleset: 'SIMPLE' },
      { simple: { sabotage: { firstRoundIndex: 0 }, shieldPerGame: 0 }, ...(override as object) },
    );
    h.start();
    h.runUntil('RISK_PICK');
    return { h, ids };
  };

  it('offers only Time Cut, Shuffle and Blind Clock; everything else is unavailable', () => {
    const { h, ids } = sabotageGame();
    for (const effect of ['FOG', 'LOCKOUT', 'POINT_TAX', 'STAKE_CAP', 'CUT'] as const)
      expect(
        refusal(
          h.command(h.actor(ids[0]!), {
            type: 'COMMIT_SABOTAGE',
            payload: { sabotage: { targetId: ids[1]!, effect, joker: 'DOUBLE_DOWN' } },
          }),
        ),
      ).toBe('POWER_UNAVAILABLE');
    expect(SABOTAGE_KINDS).toContain('JAM');
    expect(refusal(hitPlayer(h, ids[0]!, ids[1]!, 'BLIND_CLOCK'))).toBe('OK');
  });

  it('cuts the target’s window by 6 s and no more', () => {
    const { h, ids } = sabotageGame();
    hitPlayer(h, ids[0]!, ids[1]!, 'JAM');
    h.runUntil('ANSWERING');
    const round = h.round();
    expect(round.effects[ids[1]!]!.jamMs).toBe(6_000);
    expect(round.effects[ids[2]!]).toBeUndefined();
    // answering at the very end of the full window is on time for others and late for the target
    const late = round.answerDeadlineAt! - 1_000;
    expect(refusal(h.answer(ids[1]!, 'correct', late))).toBe('ANSWER_LATE');
    expect(refusal(h.answer(ids[2]!, 'correct', late))).toBe('OK');
    const view = h.view({ role: 'PLAYER', playerId: ids[1]! }).you!;
    expect(view.effects!.jamMs).toBe(6_000);
    expect(view.hits).toEqual([{ effect: 'JAM', blocked: false }]); // never names the attacker
  });

  it('hides the clock for Blind Clock and reorders the letters for Shuffle', () => {
    const { h, ids } = sabotageGame();
    hitPlayer(h, ids[0]!, ids[1]!, 'BLIND_CLOCK');
    h.runUntil('QUESTION');
    expect(h.view({ role: 'PLAYER', playerId: ids[1]! }).you!.effects!.blindClock).toBe(true);
    const second = sabotageGame();
    hitPlayer(second.h, second.ids[0]!, second.ids[1]!, 'SHUFFLE');
    second.h.runUntil('QUESTION');
    const order = second.h.view({ role: 'PLAYER', playerId: second.ids[1]! }).you!.effects!.order;
    expect(order).toHaveLength(4);
    expect(order).not.toEqual(second.h.round().question!.options.map((o) => o.optionId));
  });

  it('lets the personal shield stop the first hit in individual play', () => {
    const { h, ids } = sabotageGame({
      simple: { shieldPerGame: 1, sabotage: { firstRoundIndex: 0 } },
    });
    hitPlayer(h, ids[0]!, ids[1]!, 'JAM');
    h.runUntil('ANSWERING');
    expect(h.round().effects[ids[1]!]!.jamMs).toBe(0);
    expect(h.view({ role: 'PLAYER', playerId: ids[1]! }).you!.hits).toEqual([
      { effect: 'JAM', blocked: true },
    ]);
    expect(h.state.game!.players[ids[1]!]!.powers.shield).toBe(0);
  });

  it('refuses a team target in individual play, and a player target in team play', () => {
    const { h, ids } = sabotageGame();
    expect(refusal(hitTeam(h, ids[0]!, 'owl'))).toBe('TARGET_INVALID');
    const team = teamGame(4, { simple: { sabotage: { firstRoundIndex: 0 } } });
    team.h.runUntil('RISK_PICK');
    expect(refusal(hitPlayer(team.h, team.ids[0]!, team.ids[1]!))).toBe('TARGET_INVALID');
  });
});

describe('the question text stays on the TV', () => {
  type Frame = {
    audience: Audience;
    event: Extract<ServerEvent, { type: 'PHASE_ENTERED' }>;
  };
  const frames = (h: Harness, from: number): Frame[] =>
    h.effects.slice(from).flatMap((e): Frame[] => {
      if (e.kind !== 'emit') return [];
      const event = e.event;
      return event.type === 'PHASE_ENTERED' ? [{ audience: e.audience, event }] : [];
    });

  it('sends phones the answer options but not the question text while it is being asked', () => {
    const { h, ids } = lobby(3, { ruleset: 'SIMPLE' });
    h.start();
    h.runUntil('QUESTION');
    const mark = h.effects.length;
    h.runUntil('ANSWERING');
    const sent = frames(h, mark);
    const toDisplay = sent.filter((e) => e.audience.to === 'DISPLAY');
    const toPlayers = sent.filter((e) => e.audience.to === 'PLAYERS');
    expect(sent.some((e) => e.audience.to === 'ALL')).toBe(false);
    const display = toDisplay[0]!.event.payload.data;
    const phones = toPlayers[0]!.event.payload.data;
    if (display.phase !== 'ANSWERING' || phones.phase !== 'ANSWERING') throw new Error('phase');
    expect(display.text.length).toBeGreaterThan(0);
    expect(display.options.every((o) => o.text.length > 0)).toBe(true);
    expect(phones.text).toBe('');
    // the answers (letter + text) stay on the phone, as in the default game
    expect(phones.options).toEqual(display.options);
    // a phone that asks again (reconnect, REQUEST_STATE) gets the same
    const view = h.view({ role: 'PLAYER', playerId: ids[0]! }).phaseData;
    if (view.phase !== 'ANSWERING') throw new Error('phase');
    expect(view.text).toBe('');
    const tv = h.view({ role: 'DISPLAY' }).phaseData;
    if (tv.phase !== 'ANSWERING') throw new Error('phase');
    expect(tv.text.length).toBeGreaterThan(0);
  });

  it('shows the question in full again at the reveal, when it is no longer a secret', () => {
    const { h, ids } = lobby(3, { ruleset: 'SIMPLE' });
    h.start();
    toRound(h, ids, 0);
    playRound(h, ids);
    h.runUntil('REVEAL');
    const view = h.view({ role: 'PLAYER', playerId: ids[0]! }).phaseData;
    if (view.phase !== 'REVEAL') throw new Error('phase');
    expect(view.text.length).toBeGreaterThan(0);
  });

  it('is how every other room works: one frame to everybody, words included', () => {
    const { h } = lobby(3);
    h.start();
    h.runUntil('QUESTION');
    const mark = h.effects.length;
    h.runUntil('ANSWERING');
    const sent = frames(h, mark);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.audience).toEqual({ to: 'ALL' });
    expect(sent[0]!.event.payload.data).toMatchObject({ phase: 'ANSWERING' });
    const view = h.view({ role: 'PLAYER', playerId: h.state.playerOrder[0]! }).phaseData;
    if (view.phase !== 'ANSWERING') throw new Error('phase');
    expect(view.text.length).toBeGreaterThan(0);
  });
});

describe('the venue’s table defaults (TABLE_PRESET)', () => {
  const preset = (
    h: Harness,
    over: Partial<Extract<Parameters<Harness['apply']>[0], { kind: 'TABLE_PRESET' }>> = {},
  ) =>
    h.apply({
      kind: 'TABLE_PRESET',
      play: 'TEAMS',
      ruleset: 'SIMPLE',
      teamNames: [],
      simpleAnswerSeconds: null,
      ...over,
    });

  it('sets the mode and ruleset, deals the seated players into teams and tells every screen', () => {
    const { h, ids } = lobby(4);
    const mark = h.effects.length;
    expect(preset(h).ok).toBe(true);
    expect(h.state.settings).toMatchObject({ play: 'TEAMS', ruleset: 'SIMPLE' });
    expect(h.state.players[ids[1]!]!.teamId).toBe('owl');
    expect(
      h.effects.slice(mark).some((e) => e.kind === 'emit' && e.event.type === 'SETTINGS_CHANGED'),
    ).toBe(true);
  });

  it('carries the venue’s names for the slots, an empty one meaning the default', () => {
    const { h } = lobby(2);
    preset(h, { teamNames: ['Gusto Aslanları', '', 'Kediler'] });
    expect(h.view({ role: 'DISPLAY' }).settings.teamNames).toEqual([
      'Gusto Aslanları',
      '',
      'Kediler',
    ]);
    preset(h, { teamNames: [] });
    expect(h.view({ role: 'DISPLAY' }).settings.teamNames).toBeUndefined();
  });

  it('puts the venue’s window into the café ruleset', () => {
    const { h } = lobby(3);
    preset(h, { simpleAnswerSeconds: 40, play: 'INDIVIDUAL' });
    h.start();
    h.runUntil('QUESTION');
    expect(h.round().answerMs).toBe(
      h.round().kind === 'SPEED' ? 12_000 : h.round().kind === 'FINAL' ? 20_000 : 40_000,
    );
  });

  it('is refused while a game is running', () => {
    const { h } = lobby(3);
    h.start();
    h.runUntil('QUESTION');
    expect(refusal(preset(h))).toBe('INVALID_STATE');
  });
});

describe('determinism and recovery', () => {
  it('replays a whole team game of the simple ruleset from its inputs to the same state', () => {
    const cfg = testConfig({ simple: { sabotage: { firstRoundIndex: 0 } } });
    const h = new Harness({ config: cfg });
    const ids = h.joinPlayers(5);
    set(h, { play: 'TEAMS', ruleset: 'SIMPLE' });
    h.start();
    for (let guard = 0; guard < 800 && h.state.phase !== 'RESULTS'; guard++) {
      if (h.state.phase === 'RISK_PICK') {
        commitRisk(h, ids[0]!, true);
        hitTeam(h, ids[1]!, 'tiger', 'BLIND_CLOCK');
        hitTeam(h, ids[0]!, 'owl', 'JAM');
      }
      if (h.state.phase === 'ANSWERING')
        ids.forEach((id, i) => h.answer(id, i % 2 === 0 ? 'correct' : 'wrong'));
      if (!h.step()) break;
    }
    expect(h.state.phase).toBe('RESULTS');
    let replay = createRoom({
      roomId: TEST_ROOM_ID,
      code: 'ABC234',
      displaySessionId: h.displaySessionId,
      now: 1_700_000_000_000,
      config: cfg,
      tier: 'FULL',
    });
    for (const input of h.inputs) replay = reduce(replay, input).state;
    expect(replay).toEqual(h.state);
  });

  it('survives being stored as JSON mid-game: the restored room finishes the same game', () => {
    const { h, ids } = teamGame(4, { simple: { sabotage: { firstRoundIndex: 0 } } });
    toRound(h, ids, 2);
    const stored = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
    const twin = new Harness({ config: testConfig() });
    twin.state = stored;
    twin.now = h.now;
    h.runUntil('RESULTS');
    twin.runUntil('RESULTS');
    // the two runs use different entropy for later questions' options, but the team structure matches
    expect(twin.state.game!.teams).toEqual(h.state.game!.teams);
    expect(twin.state.config.ruleset).toBe('SIMPLE');
    expect(twin.state.baseConfig).toEqual(h.state.baseConfig);
  });
});
