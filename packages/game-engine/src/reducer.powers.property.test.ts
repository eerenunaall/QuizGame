import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RoomViewSchema, YouViewSchema } from '@quizparty/protocol';
import { createRoom, reduce } from './reducer';
import { Harness, TEST_ROOM_ID, testConfig } from './testing';

/**
 * Whatever players throw at the power system (any stakes, any sabotage, any lifelines, in any
 * order), the invariants of ADR-0007 and ADR-0010 hold and the log replays to the same state.
 */
const tier = fc.constantFrom('SAFE', 'RISK', 'HIGH', 'ALL_IN' as const);
const effect = fc.constantFrom('JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX' as const);
const joker = fc.constantFrom('FIFTY_FIFTY', 'DOUBLE_DOWN' as const);

const playerPlan = fc.record({
  commit: fc.option(
    fc.record({
      stake: tier,
      doubleDown: fc.boolean(),
      sabotage: fc.option(fc.record({ target: fc.integer({ min: 0, max: 4 }), effect, joker }), {
        nil: null,
      }),
    }),
    { nil: null },
  ),
  fiftyFifty: fc.boolean(),
  answer: fc.constantFrom('correct', 'wrong', 'none' as const),
  reduced: fc.boolean(),
});

const gamePlan = fc.array(fc.array(playerPlan, { minLength: 4, maxLength: 4 }), {
  minLength: 10,
  maxLength: 10,
});

const config = () => testConfig({ defaultRounds: 10 });

describe('powers: invariants for any play', () => {
  it('keeps counters, windows and views within their bounds, and replays deterministically', () => {
    fc.assert(
      fc.property(gamePlan, (plan) => {
        const cfg = config();
        const h = new Harness({ config: cfg });
        const ids = h.joinPlayers(4);
        h.start();
        const { powers } = cfg;

        for (const round of plan) {
          if (h.state.phase === 'RESULTS') break;
          h.runUntil('QUESTION_PREP');
          round.forEach((p, i) => {
            h.command(h.actor(ids[i]!), {
              type: 'SET_PREFERENCES',
              payload: { reducedEffects: p.reduced },
            });
          });
          round.forEach((p, i) => {
            if (!p.commit || h.state.phase !== 'QUESTION_PREP') return;
            h.command(h.actor(ids[i]!), {
              type: 'COMMIT_PREP',
              payload: {
                stake: p.commit.stake,
                doubleDown: p.commit.doubleDown,
                sabotage: p.commit.sabotage
                  ? {
                      targetId: ids[p.commit.sabotage.target % ids.length]!,
                      effect: p.commit.sabotage.effect,
                      joker: p.commit.sabotage.joker,
                    }
                  : null,
              },
            });
          });
          h.runUntil('ANSWERING');
          const game = h.state.game!;
          const live = game.round!;

          // Window and options: nobody is left with less than 80 % of the time or fewer than 2 options.
          for (const id of ids) {
            const fx = live.effects[id];
            if (fx) expect(live.answerMs - fx.jamMs).toBeGreaterThanOrEqual(live.answerMs * 0.8);
          }
          const sabotageCount = Object.values(live.commitments).filter((c) => c.sabotage).length;
          expect(sabotageCount).toBeLessThanOrEqual(powers.sabotage.maxPerRound);
          const targets = Object.values(live.commitments)
            .filter((c) => c.sabotage)
            .map((c) => c.sabotage!.targetId);
          expect(new Set(targets).size).toBe(targets.length); // never two hits on one target a round

          round.forEach((p, i) => {
            if (p.fiftyFifty) h.command(h.actor(ids[i]!), { type: 'USE_FIFTY_FIFTY', payload: {} });
          });
          for (const id of ids) {
            if (live.fiftyFiftyUsers[id]) {
              const selectable = live.fiftyFifty!.keep.length;
              expect(selectable).toBeGreaterThanOrEqual(2);
              expect(live.fiftyFifty!.keep).toContain(live.question!.correctOptionId);
            }
          }
          round.forEach((p, i) => {
            if (p.answer !== 'none') h.answer(ids[i]!, p.answer);
          });
          h.runUntil('SCORE_UPDATE');

          for (const id of ids) {
            const gp = h.state.game!.players[id]!;
            expect(Number.isSafeInteger(gp.score) && gp.score >= 0).toBe(true);
            expect(gp.powers.fiftyFifty).toBeGreaterThanOrEqual(0);
            expect(gp.powers.fiftyFifty).toBeLessThanOrEqual(powers.fiftyFiftyPerGame);
            expect(gp.powers.doubleDown).toBeGreaterThanOrEqual(0);
            expect(gp.powers.doubleDown).toBeLessThanOrEqual(powers.doubleDownPerGame);
            expect(gp.powers.shield).toBeGreaterThanOrEqual(0);
            expect(gp.powers.shield).toBeLessThanOrEqual(powers.shieldPerGame);
            expect(gp.powers.tokens).toBeGreaterThanOrEqual(0);
            expect(gp.powers.tokens).toBeLessThanOrEqual(powers.sabotage.maxTokens);
            expect(gp.powers.hits).toBeLessThanOrEqual(powers.sabotage.targetMaxPerGame);
          }

          // Every view of every viewer is valid and never carries another player's choices.
          const viewers = [
            { role: 'DISPLAY' } as const,
            ...ids.map((playerId) => ({ role: 'PLAYER', playerId }) as const),
          ];
          for (const viewer of viewers) {
            const view = h.view(viewer);
            expect(RoomViewSchema.safeParse(view).success).toBe(true);
            if (view.you) expect(YouViewSchema.safeParse(view.you).success).toBe(true);
          }
        }

        // Replaying the logged inputs reproduces the state exactly (ADR-0006).
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
      }),
      { numRuns: 40 },
    );
  });
});
