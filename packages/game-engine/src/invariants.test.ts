import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PHASES, RoomViewSchema, scanForbiddenKeys, type Phase } from '@quizparty/protocol';
import { createRoom, reduce } from './reducer';
import { nextWakeAt } from './timers';
import { Harness, TEST_ROOM_ID, testConfig } from './testing';
import type { RoomState } from './types';

type Action =
  | { t: 'join'; n: number }
  | { t: 'leave'; p: number }
  | { t: 'kick'; p: number }
  | { t: 'ready'; p: number; v: boolean }
  | { t: 'answer'; p: number; o: number; dt: number; garbage: boolean }
  | { t: 'tick'; dt: number }
  | { t: 'step' }
  | { t: 'disc'; p: number }
  | { t: 'conn'; p: number }
  | { t: 'display'; v: boolean }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'lobby' }
  | { t: 'settings'; rounds: number }
  | { t: 'forged'; p: number }
  | { t: 'recover'; outage: number }
  | {
      t: 'commit';
      p: number;
      stake: number;
      dd: boolean;
      target: number | null;
      effect: number;
      joker: number;
    }
  | { t: 'fifty'; p: number }
  | { t: 'prefs'; p: number; v: boolean };

const arbAction: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({ t: fc.constant('join' as const), n: fc.integer({ min: 0, max: 999 }) }),
  },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('leave' as const), p: fc.nat(9) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('kick' as const), p: fc.nat(9) }) },
  {
    weight: 2,
    arbitrary: fc.record({ t: fc.constant('ready' as const), p: fc.nat(9), v: fc.boolean() }),
  },
  {
    weight: 8,
    arbitrary: fc.record({
      t: fc.constant('answer' as const),
      p: fc.nat(9),
      o: fc.nat(5),
      dt: fc.integer({ min: 0, max: 16_000 }),
      garbage: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      t: fc.constant('tick' as const),
      dt: fc.integer({ min: 0, max: 20_000 }),
    }),
  },
  { weight: 12, arbitrary: fc.constant({ t: 'step' as const }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('disc' as const), p: fc.nat(9) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('conn' as const), p: fc.nat(9) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('display' as const), v: fc.boolean() }) },
  { weight: 3, arbitrary: fc.constant({ t: 'start' as const }) },
  { weight: 1, arbitrary: fc.constant({ t: 'rematch' as const }) },
  { weight: 1, arbitrary: fc.constant({ t: 'lobby' as const }) },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant('settings' as const),
      rounds: fc.integer({ min: 1, max: 12 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('forged' as const), p: fc.nat(9) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant('recover' as const),
      outage: fc.integer({ min: 0, max: 60_000 }),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      t: fc.constant('commit' as const),
      p: fc.nat(9),
      stake: fc.nat(3),
      dd: fc.boolean(),
      target: fc.option(fc.nat(9), { nil: null }),
      effect: fc.nat(4),
      joker: fc.nat(1),
    }),
  },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('fifty' as const), p: fc.nat(9) }) },
  {
    weight: 1,
    arbitrary: fc.record({ t: fc.constant('prefs' as const), p: fc.nat(9), v: fc.boolean() }),
  },
);

const TIERS = ['SAFE', 'RISK', 'HIGH', 'ALL_IN'] as const;
const EFFECTS = ['JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX'] as const;
const JOKERS = ['FIFTY_FIFTY', 'DOUBLE_DOWN'] as const;

const POST_REVEAL: ReadonlySet<Phase> = new Set(['REVEAL', 'POWER_RESOLUTION', 'SCORE_UPDATE']);

function checkInvariants(h: Harness, previous: RoomState): void {
  const s = h.state;
  expect(PHASES).toContain(s.phase);
  expect(s.phase).not.toBe('NEXT_ROUND');
  expect(s.version).toBeGreaterThanOrEqual(previous.version);
  expect(s.version === previous.version).toBe(s === previous);
  if (s !== previous) expect(s.version).toBe(previous.version + 1);

  const active = Object.values(s.players).filter((p) => p.status === 'ACTIVE');
  expect(new Set(active.map((p) => p.nicknameKey)).size).toBe(active.length);
  expect(s.playerOrder.slice().sort()).toEqual(active.map((p) => p.playerId).sort());
  expect(active.length).toBeLessThanOrEqual(s.config.maxPlayers);
  if (s.leaderPlayerId !== null) expect(s.players[s.leaderPlayerId]?.status).toBe('ACTIVE');
  if (active.length > 0 && s.phase !== 'ROOM_CLOSED') expect(s.leaderPlayerId).not.toBeNull();
  expect(new Set(active.map((p) => p.colorSlot)).size).toBe(active.length);

  if (s.phaseDeadlineAt !== null)
    expect(s.phaseDeadlineAt).toBeGreaterThanOrEqual(s.phaseEnteredAt);

  const game = s.game;
  if (game) {
    for (const [playerId, gp] of Object.entries(game.players)) {
      expect(Number.isSafeInteger(gp.score) && gp.score >= 0, `score of ${playerId}`).toBe(true);
      expect(gp.streak).toBeGreaterThanOrEqual(0);
      expect(gp.bestStreak).toBeGreaterThanOrEqual(gp.streak);
      expect(s.players[playerId]).toBeDefined();
    }
    const { powers } = s.config;
    for (const [playerId, gp] of Object.entries(game.players)) {
      const ledger = gp.powers;
      expect(ledger.fiftyFifty, `50/50 of ${playerId}`).toBeGreaterThanOrEqual(0);
      expect(ledger.fiftyFifty).toBeLessThanOrEqual(powers.fiftyFiftyPerGame);
      expect(ledger.doubleDown).toBeGreaterThanOrEqual(0);
      expect(ledger.doubleDown).toBeLessThanOrEqual(powers.doubleDownPerGame);
      expect(ledger.shield).toBeGreaterThanOrEqual(0);
      expect(ledger.shield).toBeLessThanOrEqual(powers.shieldPerGame);
      expect(ledger.tokens).toBeGreaterThanOrEqual(0);
      expect(ledger.tokens).toBeLessThanOrEqual(powers.sabotage.maxTokens);
      expect(ledger.hits).toBeLessThanOrEqual(powers.sabotage.targetMaxPerGame);
    }
    const round = game.round;
    if (round) {
      const sabotageCommits = Object.values(round.commitments).filter((c) => c.sabotage);
      expect(sabotageCommits.length).toBeLessThanOrEqual(powers.sabotage.maxPerRound);
      for (const [playerId, commitment] of Object.entries(round.commitments)) {
        expect(game.players[playerId]).toBeDefined();
        if (commitment.sabotage) expect(commitment.sabotage.targetId).not.toBe(playerId);
      }
      for (const [playerId, fx] of Object.entries(round.effects)) {
        expect(game.players[playerId]).toBeDefined();
        expect(round.answerMs - fx.jamMs).toBeGreaterThanOrEqual(round.answerMs * 0.8);
      }
      for (const playerId of Object.keys(round.fiftyFiftyUsers)) {
        expect(game.players[playerId]).toBeDefined();
        expect(round.fiftyFifty!.keep.length).toBeGreaterThanOrEqual(2);
        expect(round.fiftyFifty!.keep).toContain(round.question!.correctOptionId);
      }
      for (const [playerId, answer] of Object.entries(round.answers)) {
        expect(game.players[playerId]).toBeDefined();
        expect(answer.remainingMs).toBeGreaterThanOrEqual(0);
        expect(answer.remainingMs).toBeLessThanOrEqual(round.answerMs);
        expect(answer.offsetMs).toBeGreaterThanOrEqual(0);
        expect(round.question!.options.some((o) => o.optionId === answer.optionId)).toBe(true);
      }
      if (round.outcome) {
        for (const result of Object.values(round.outcome.players)) {
          expect(Number.isSafeInteger(result.delta)).toBe(true);
        }
      }
    }
  }

  // Views always validate, and before the reveal they never carry a forbidden key.
  const viewers = [
    { role: 'DISPLAY' as const },
    ...s.playerOrder.map((playerId) => ({ role: 'PLAYER' as const, playerId })),
  ];
  for (const viewer of viewers) {
    const view = h.view(viewer);
    const parsed = RoomViewSchema.safeParse(view);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 2))).toBe(true);
    if (!POST_REVEAL.has(s.phase)) expect(scanForbiddenKeys(view)).toEqual([]);
  }
}

function run(actions: Action[]): void {
  const h = new Harness({ config: testConfig() });
  let nextJoin = 0;
  const ids = (): string[] => Object.keys(h.state.players);
  const pick = (p: number): string | undefined => {
    const all = ids();
    return all.length === 0 ? undefined : all[p % all.length];
  };

  for (const action of actions) {
    const previous = h.state;
    switch (action.t) {
      case 'join': {
        nextJoin += 1;
        h.apply({
          kind: 'PLAYER_JOIN',
          player: {
            playerId: `p${nextJoin}`,
            sessionId: `s-p${nextJoin}`,
            nickname: `Nick${action.n % 12}`,
            nicknameKey: `nick${action.n % 12}`,
            avatarId: 'fox',
          },
        });
        break;
      }
      case 'leave': {
        const id = pick(action.p);
        if (id) h.command(h.actor(id), { type: 'LEAVE_ROOM', payload: {} });
        break;
      }
      case 'kick': {
        const id = pick(action.p);
        if (id) h.command(h.displayActor(), { type: 'KICK_PLAYER', payload: { playerId: id } });
        break;
      }
      case 'ready': {
        const id = pick(action.p);
        if (id) h.command(h.actor(id), { type: 'READY', payload: { ready: action.v } });
        break;
      }
      case 'answer': {
        const id = pick(action.p);
        const question = h.state.game?.round?.question;
        if (id) {
          h.command(
            h.actor(id),
            {
              type: 'SUBMIT_ANSWER',
              payload: {
                questionId: action.garbage ? 'nope' : (question?.questionId ?? 'q1'),
                optionId:
                  question && !action.garbage
                    ? question.options[action.o % question.options.length]!.optionId
                    : 'AAAAAAAAAAAA',
              },
            },
            h.now + action.dt,
          );
        }
        break;
      }
      case 'tick':
        h.tickAt(h.now + action.dt);
        break;
      case 'step': {
        const wake = nextWakeAt(h.state, h.now);
        const version = h.state.version;
        const now = h.now;
        h.step();
        if (wake !== null && h.state.version === version && h.state.phase !== 'ROOM_CLOSED') {
          // A tick that changes nothing must not leave an already-due wake-up behind (no busy loop).
          const after = nextWakeAt(h.state, Math.max(now, wake));
          expect(after === null || after > Math.max(now, wake)).toBe(true);
        }
        break;
      }
      case 'disc': {
        const id = pick(action.p);
        if (id) h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: false });
        break;
      }
      case 'conn': {
        const id = pick(action.p);
        if (id) h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: true });
        break;
      }
      case 'display':
        h.apply({ kind: 'DISPLAY_CONNECTION', connected: action.v });
        break;
      case 'start':
        h.command(h.displayActor(), { type: 'START_GAME', payload: {} });
        break;
      case 'rematch':
        h.command(h.displayActor(), { type: 'REMATCH', payload: {} });
        break;
      case 'lobby':
        h.command(h.displayActor(), { type: 'BACK_TO_LOBBY', payload: {} });
        break;
      case 'settings':
        h.command(h.displayActor(), {
          type: 'SET_SETTINGS',
          payload: { rounds: Math.min(10, Math.max(3, action.rounds)) },
        });
        break;
      case 'forged': {
        const id = pick(action.p);
        if (id) {
          const forged = h.command(
            { role: 'PLAYER', sessionId: 'stolen-session', playerId: id },
            { type: 'END_ROOM', payload: {} },
          );
          expect(forged.ok).toBe(false);
        }
        break;
      }
      case 'recover':
        h.apply({ kind: 'RECOVER', outageMs: action.outage }, h.now + action.outage);
        break;
      case 'commit': {
        const id = pick(action.p);
        const target = action.target === null ? undefined : pick(action.target);
        if (id) {
          h.command(h.actor(id), {
            type: 'COMMIT_PREP',
            payload: {
              stake: TIERS[action.stake % TIERS.length]!,
              doubleDown: action.dd,
              sabotage: target
                ? {
                    targetId: target,
                    effect: EFFECTS[action.effect % EFFECTS.length]!,
                    joker: JOKERS[action.joker % JOKERS.length]!,
                  }
                : null,
            },
          });
        }
        break;
      }
      case 'fifty': {
        const id = pick(action.p);
        if (id) h.command(h.actor(id), { type: 'USE_FIFTY_FIFTY', payload: {} });
        break;
      }
      case 'prefs': {
        const id = pick(action.p);
        if (id)
          h.command(h.actor(id), {
            type: 'SET_PREFERENCES',
            payload: { reducedEffects: action.v },
          });
        break;
      }
    }
    checkInvariants(h, previous);
  }

  // Exact replay: folding the logged inputs over a fresh room reproduces the final state.
  let replay = createRoom({
    roomId: TEST_ROOM_ID,
    code: 'ABC234',
    displaySessionId: h.displaySessionId,
    now: 1_700_000_000_000,
    config: testConfig(),
    tier: 'FULL',
  });
  for (const input of h.inputs) replay = reduce(replay, input).state;
  expect(JSON.parse(JSON.stringify(replay))).toEqual(JSON.parse(JSON.stringify(h.state)));
}

describe('engine invariants under random input', () => {
  it('holds for arbitrary interleavings of joins, answers, ticks, disconnects, forged commands and recoveries', () => {
    fc.assert(fc.property(fc.array(arbAction, { minLength: 1, maxLength: 150 }), run), {
      numRuns: 120,
    });
  });

  it('holds for long games that actually reach the later phases', { timeout: 60_000 }, () => {
    const biased = fc.array(
      fc.oneof(
        { weight: 10, arbitrary: fc.constant({ t: 'step' as const }) },
        { weight: 4, arbitrary: arbAction },
      ),
      { minLength: 200, maxLength: 400 },
    );
    fc.assert(
      fc.property(biased, (actions) => {
        const setup: Action[] = [
          { t: 'join', n: 1 },
          { t: 'join', n: 2 },
          { t: 'join', n: 3 },
          { t: 'start' },
        ];
        run([...setup, ...actions]);
      }),
      { numRuns: 40 },
    );
  });
});
