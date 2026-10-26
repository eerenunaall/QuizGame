import { describe, expect, it } from 'vitest';
import type { Phase } from '@quizparty/protocol';
import { PhaseDataSchema, RoomViewSchema } from '@quizparty/protocol';
import { DEFAULT_GAME_CONFIG, GameConfigSchema, resolveGameConfig } from './config';
import { normalizeRecoveredState } from './reducer';
import { Harness, testConfig } from './testing';
import { phaseDataFor } from './views';
import { nextWakeAt } from './timers';

/**
 * ADR-0022: RISK_PICK and SABOTAGE_PICK are two timed screens in place of the old single prep window.
 * These tests pin the order, the skipping rules, the timers, the early advance, the counts-only
 * progress and the back-compat of stored data.
 */
function setup(players = 3, override: unknown = {}) {
  const h = new Harness({ config: testConfig(override) });
  const ids = h.joinPlayers(players);
  h.start();
  return { h, ids };
}

const risk = (h: Harness, id: string, stake: 'SAFE' | 'RISK' | 'HIGH' = 'SAFE') =>
  h.command(h.actor(id), { type: 'COMMIT_RISK', payload: { stake, doubleDown: false } });
const sabotage = (h: Harness, id: string, targetId: string | null) =>
  h.command(h.actor(id), {
    type: 'COMMIT_SABOTAGE',
    payload: { sabotage: targetId ? { targetId, effect: 'JAM' } : null },
  });

/** Runs to the SABOTAGE_PICK of round `index` (0-based), letting RISK_PICK time out. */
function toSabotage(h: Harness, index: number): void {
  for (let guard = 0; guard < 40; guard++) {
    h.runUntil('RISK_PICK');
    if (h.round().index === index) break;
    h.runUntil('SCORE_UPDATE');
  }
  h.runUntil('SABOTAGE_PICK');
}

const phasesOfRound = (h: Harness, from: number): Phase[] => h.phaseEvents().slice(from);

describe('phase order', () => {
  it('runs ROUND_INTRO, RISK_PICK, SABOTAGE_PICK, QUESTION in that order', () => {
    const { h } = setup();
    toSabotage(h, 2);
    h.runUntil('QUESTION');
    const phases = h.phaseEvents();
    const from = phases.lastIndexOf('ROUND_INTRO');
    expect(phasesOfRound(h, from).slice(0, 4)).toEqual([
      'ROUND_INTRO',
      'RISK_PICK',
      'SABOTAGE_PICK',
      'QUESTION',
    ]);
    // The retired phase is never entered.
    expect(phases).not.toContain('QUESTION_PREP');
  });

  it('skips SABOTAGE_PICK in the first rounds and the final stage', () => {
    const { h } = setup();
    h.runUntil('RISK_PICK'); // round 1
    h.runUntil('QUESTION');
    expect(h.phaseEvents()).not.toContain('SABOTAGE_PICK');
    for (let guard = 0; guard < 40 && h.round().kind !== 'FINAL'; guard++) {
      h.runUntil('SCORE_UPDATE');
      h.runUntil('RISK_PICK');
    }
    expect(h.round().kind).toBe('FINAL');
    const before = h.phaseEvents().length;
    h.runUntil('QUESTION');
    expect(h.phaseEvents().slice(before)).not.toContain('SABOTAGE_PICK');
  });

  it('skips SABOTAGE_PICK when sabotage is switched off', () => {
    const { h } = setup(3, { powers: { sabotage: { enabled: false } } });
    h.runUntil('RESULTS');
    expect(h.phaseEvents()).not.toContain('SABOTAGE_PICK');
    expect(h.phaseEvents()).toContain('RISK_PICK');
  });

  it('skips SABOTAGE_PICK when nobody holds a token', () => {
    const { h } = setup(3, { powers: { sabotage: { startTokens: 0 } } });
    h.runUntil('RESULTS');
    expect(h.phaseEvents()).not.toContain('SABOTAGE_PICK');
  });

  it('skips SABOTAGE_PICK when every token holder is offline', () => {
    const { h, ids } = setup(3);
    h.runUntil('RISK_PICK');
    for (const id of ids) h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: false });
    h.runUntil('QUESTION');
    expect(h.phaseEvents()).not.toContain('SABOTAGE_PICK');
  });

  it('skips RISK_PICK when nobody can choose anything', () => {
    const config = testConfig({ powers: { doubleDownPerGame: 0 } });
    config.scoring.ladders.STANDARD = { SAFE: { multiplier: 1, loss: 0 } };
    const h = new Harness({ config });
    h.joinPlayers(3);
    h.start();
    h.runUntil('QUESTION');
    expect(h.phaseEvents()).not.toContain('RISK_PICK');
  });

  it('keeps RISK_PICK for Double Down alone when there is a single rung', () => {
    const config = testConfig();
    config.scoring.ladders.STANDARD = { SAFE: { multiplier: 1, loss: 0 } };
    const h = new Harness({ config });
    h.joinPlayers(3);
    h.start();
    h.runUntil('QUESTION');
    expect(h.phaseEvents()).toContain('RISK_PICK');
  });

  it('skips SABOTAGE_PICK for players on cooldown, and for the whole table when all are', () => {
    const { h, ids } = setup(3);
    toSabotage(h, 2);
    expect(sabotage(h, ids[0]!, ids[1]!).ok).toBe(true);
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK'); // round 4: p1 is cooling down, the others still hold their tokens
    expect(h.state.game!.players[ids[0]!]!.powers.lastSabotageRound).toBe(2);
    h.runUntil('SABOTAGE_PICK');
    expect(h.view({ role: 'PLAYER', playerId: ids[0]! }).you!.sabotage).toEqual({
      ready: false,
      decided: false,
    });
    expect(h.view({ role: 'PLAYER', playerId: ids[1]! }).you!.sabotage).toMatchObject({
      ready: true,
    });
  });
});

describe('timers', () => {
  it('gives each screen its own window', () => {
    const { h } = setup(3, {
      timings: { riskPickMs: 3000, riskPickDecisionMs: 7000, sabotagePickMs: 4000 },
    });
    toSabotage(h, 2);
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(4000);
  });

  it('uses the longer decision window in RISK and FINAL rounds', () => {
    const { h } = setup(3, { timings: { riskPickMs: 3000, riskPickDecisionMs: 7000 } });
    for (let guard = 0; guard < 40; guard++) {
      h.runUntil('RISK_PICK');
      const kind = h.round().kind;
      const window = h.state.phaseDeadlineAt! - h.state.phaseEnteredAt;
      expect(window).toBe(kind === 'RISK' || kind === 'FINAL' ? 7000 : 3000);
      if (h.state.game!.roundIndex >= 8) break;
      h.runUntil('SCORE_UPDATE');
    }
  });

  it('defaults to 12 s, 16 s and 12 s', () => {
    const { h } = setup(3, {});
    h.runUntil('RISK_PICK');
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(12_000);
    toSabotage(h, 2);
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(12_000);
    expect(DEFAULT_GAME_CONFIG.timings.riskPickDecisionMs).toBe(16_000);
  });

  it('wakes the server at the pick deadline', () => {
    const { h } = setup();
    h.runUntil('RISK_PICK');
    expect(nextWakeAt(h.state, h.now)).toBe(h.state.phaseDeadlineAt);
  });
});

describe('early advance', () => {
  it('leaves RISK_PICK when every connected player has confirmed', () => {
    const { h, ids } = setup(3);
    h.runUntil('RISK_PICK');
    risk(h, ids[0]!);
    risk(h, ids[1]!);
    expect(h.state.phase).toBe('RISK_PICK');
    risk(h, ids[2]!);
    expect(h.state.phase).not.toBe('RISK_PICK');
  });

  it('keeps RISK_PICK open for an online player when somebody who confirmed has dropped', () => {
    // Regression: the count of confirmations included the dropped phone, so 2 of 2 "online" looked done
    // and the third player lost their stake choice.
    const { h, ids } = setup(3);
    h.runUntil('RISK_PICK');
    risk(h, ids[0]!);
    h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[0]!, connected: false });
    risk(h, ids[1]!);
    expect(h.state.phase).toBe('RISK_PICK');
    const data = h.view({ role: 'DISPLAY' }).phaseData as {
      committedCount: number;
      eligibleCount: number;
    };
    expect(data.committedCount).toBeLessThan(data.eligibleCount);
    h.tickAt(h.now + 1); // a tick on the way does not end it either
    expect(h.state.phase).toBe('RISK_PICK');
    expect(risk(h, ids[2]!, 'RISK').ok).toBe(true);
    expect(h.state.phase).not.toBe('RISK_PICK');
  });

  it('leaves SABOTAGE_PICK when every player who can act has confirmed, passing included', () => {
    const { h, ids } = setup(3);
    toSabotage(h, 2);
    expect(sabotage(h, ids[0]!, null).ok).toBe(true);
    expect(sabotage(h, ids[1]!, ids[2]!).ok).toBe(true);
    expect(h.state.phase).toBe('SABOTAGE_PICK');
    expect(sabotage(h, ids[2]!, null).ok).toBe(true);
    expect(h.state.phase).toBe('QUESTION');
  });

  it('does not wait for a player who cannot act', () => {
    const { h, ids } = setup(3);
    toSabotage(h, 2);
    // p3 spends the only token in round 3; the next sabotage screen needs only the other two.
    expect(sabotage(h, ids[2]!, ids[0]!).ok).toBe(true);
    sabotage(h, ids[0]!, null);
    sabotage(h, ids[1]!, null);
    h.runUntil('SCORE_UPDATE');
    h.runUntil('SABOTAGE_PICK'); // round 4
    expect(sabotage(h, ids[0]!, null).ok).toBe(true);
    expect(sabotage(h, ids[1]!, null).ok).toBe(true);
    expect(h.state.phase).toBe('QUESTION'); // p3 is cooling down and was not waited for
  });
});

describe('legality by phase', () => {
  it('refuses a sabotage in RISK_PICK and a stake in SABOTAGE_PICK with INVALID_STATE', () => {
    const { h, ids } = setup(3);
    h.runUntil('RISK_PICK');
    h.runUntil('SABOTAGE_PICK');
    expect(risk(h, ids[0]!, 'RISK')).toEqual({ ok: false, code: 'INVALID_STATE' });
    h.runUntil('SCORE_UPDATE');
    h.runUntil('RISK_PICK');
    expect(sabotage(h, ids[0]!, ids[1]!)).toEqual({ ok: false, code: 'INVALID_STATE' });
  });

  it('takes one decision per screen and per player', () => {
    const { h, ids } = setup(3);
    toSabotage(h, 2);
    expect(sabotage(h, ids[0]!, null).ok).toBe(true);
    expect(sabotage(h, ids[0]!, ids[1]!)).toEqual({ ok: false, code: 'ALREADY_COMMITTED' });
  });

  it('applies a sabotage picked on its own screen to the question', () => {
    const { h, ids } = setup(3, { powers: { shieldPerGame: 0 } });
    toSabotage(h, 2);
    sabotage(h, ids[0]!, ids[1]!);
    h.runUntil('ANSWERING');
    expect(h.view({ role: 'PLAYER', playerId: ids[1]! }).you!.hits).toEqual([
      { effect: 'JAM', blocked: false },
    ]);
  });
});

describe('progress is counts only (ATTACK 27)', () => {
  it('shows how many confirmed out of everybody, never who or who could', () => {
    const { h, ids } = setup(4);
    toSabotage(h, 2);
    const display = () => h.view({ role: 'DISPLAY' }).phaseData;
    expect(display()).toMatchObject({
      phase: 'SABOTAGE_PICK',
      committedCount: 0,
      eligibleCount: 4,
    });
    sabotage(h, ids[2]!, ids[0]!);
    const data = display();
    expect(data).toMatchObject({ committedCount: 1, eligibleCount: 4 });
    // `offered` is the sabotage menu (config, ADR-0023): the same list whoever picked what.
    const wire = JSON.stringify([{ ...data, offered: undefined }, h.events('PREP_PROGRESS')]);
    expect(wire).not.toContain(ids[2]!);
    expect(wire).not.toContain('JAM');
    expect(wire).not.toContain('targetId');
    expect(Object.keys(data).sort()).toEqual(
      [
        'category',
        'committedCount',
        'cutRule',
        'difficulty',
        'eligibleCount',
        'offered',
        'phase',
        'round',
      ].sort(),
    );
    expect(JSON.stringify(data)).toEqual(JSON.stringify(display()));
    // Other phones learn nothing either.
    expect(h.view({ role: 'PLAYER', playerId: ids[1]! }).you!.commitment).toBeNull();
    expect(JSON.stringify(h.view({ role: 'PLAYER', playerId: ids[1]! }))).not.toContain(
      `"targetId":"${ids[0]!}"`,
    );
  });
});

describe('stored data from before ADR-0022 still loads', () => {
  it('parses a config without the new timings and reads the defaults', () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_GAME_CONFIG)) as typeof DEFAULT_GAME_CONFIG;
    delete old.timings.riskPickMs;
    delete old.timings.riskPickDecisionMs;
    delete old.timings.sabotagePickMs;
    const parsed = GameConfigSchema.parse(old);
    expect(parsed.timings.riskPickMs).toBeUndefined();
    const h = new Harness({ config: parsed });
    h.joinPlayers(3);
    h.start();
    h.runUntil('RISK_PICK');
    expect(h.state.phaseDeadlineAt! - h.state.phaseEnteredAt).toBe(12_000);
  });

  it('accepts overrides for the new timings only within bounds', () => {
    expect(() => resolveGameConfig({ timings: { riskPickMs: 90_000 } })).toThrow();
    expect(resolveGameConfig({ timings: { sabotagePickMs: 5000 } }).timings.sabotagePickMs).toBe(
      5000,
    );
  });

  it('treats a recovered QUESTION_PREP as RISK_PICK', () => {
    const { h } = setup();
    h.runUntil('RISK_PICK');
    const stored = { ...h.state, phase: 'QUESTION_PREP' } as unknown as typeof h.state;
    const view = phaseDataFor(stored);
    expect(view.phase).toBe('RISK_PICK');
    h.state = normalizeRecoveredState(stored);
    expect(h.state.phase).toBe('RISK_PICK');
    h.runUntil('QUESTION'); // the room carries on
  });

  it('loads a round that has no sabotagePicks field', () => {
    const { h, ids } = setup();
    toSabotage(h, 2);
    const legacy = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
    delete legacy.game!.round!.sabotagePicks;
    h.state = legacy;
    expect(h.view({ role: 'PLAYER', playerId: ids[0]! }).you).not.toBeNull();
    expect(sabotage(h, ids[0]!, null).ok).toBe(true);
  });

  it('keeps the retired phase and its data shape in the protocol so old clients parse it', () => {
    expect(
      PhaseDataSchema.safeParse({
        phase: 'QUESTION_PREP',
        round: {
          index: 0,
          total: 5,
          kind: 'STANDARD',
          isFinal: false,
          finalStage: null,
          basePoints: 100,
          speedMax: 100,
          answerMs: 25000,
        },
        category: { id: 'x', label: 'X' },
        difficulty: 'EASY',
        riskLadder: [{ tier: 'SAFE', multiplier: 1, loss: 0 }],
        stakeMandatory: false,
        doubleDownEnabled: true,
        sabotageEnabled: false,
        committedCount: 0,
        eligibleCount: 0,
      }).success,
    ).toBe(true);
  });

  it('every view of the new phases satisfies the strict outbound schema', () => {
    const { h, ids } = setup();
    for (let guard = 0; guard < 40; guard++) {
      h.runUntil('RISK_PICK');
      if (h.round().index === 2) break;
      h.runUntil('SCORE_UPDATE');
    }
    for (const phase of ['RISK_PICK', 'SABOTAGE_PICK'] as const) {
      h.runUntil(phase);
      for (const viewer of [
        { role: 'DISPLAY' } as const,
        { role: 'PLAYER', playerId: ids[0]! } as const,
      ]) {
        const parsed = RoomViewSchema.safeParse(h.view(viewer));
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      }
    }
  });
});
