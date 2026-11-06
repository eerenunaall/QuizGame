import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RoomViewSchema, YouViewSchema, scanForbiddenKeys } from '@quizparty/protocol';
import { maxTotalMultiplierFor } from './config';
import { createRoom, reduce } from './reducer';
import { sumComponents } from './scoring';
import { Harness, TEST_ROOM_ID, testConfig } from './testing';

/**
 * ADR-0023 invariants for any play: whatever stakes, extras, replies, sabotages, answers and
 * disconnects the players throw at it, scores never go negative, the audit trail adds up, Pot, Duel and
 * Cut only move points, no gain passes the multiplier ceiling, nobody holds two big gambles, nothing
 * unrevealed reaches a view, and the log replays to the same state.
 */
const tier = fc.constantFrom('SAFE', 'RISK', 'RISK', 'HIGH', 'ALL_IN' as const);
const effect = fc.constantFrom(
  'CUT',
  'CUT',
  'STAKE_CAP',
  'BLIND_CLOCK',
  'JAM',
  'SHUFFLE',
  'FOG',
  'LOCKOUT',
  'POINT_TAX',
  'STAKE_CAP',
  'CUT',
  'BLIND_CLOCK' as const,
);
const joker = fc.constantFrom('FIFTY_FIFTY', 'DOUBLE_DOWN' as const);
const seat = fc.integer({ min: 0, max: 4 });

const playerPlan = fc.record({
  risk: fc.option(
    fc.record({
      stake: tier,
      doubleDown: fc.constantFrom(false, false, false, true),
      cover: fc.constantFrom(false, false, true),
      pot: fc.constantFrom(true, true, false),
      duel: fc.option(seat, { nil: null, freq: 3 }),
    }),
    { nil: null, freq: 8 },
  ),
  reply: fc.constantFrom('accept', 'accept', 'decline', 'none' as const),
  sabotage: fc.option(fc.record({ target: seat, effect, joker }), { nil: null, freq: 3 }),
  // mostly right, so scores build up (Pot needs its ante, Cut needs points to take)
  answer: fc.constantFrom('correct', 'correct', 'correct', 'wrong', 'none' as const),
  offsetMs: fc.integer({ min: 100, max: 20_000 }),
  offline: fc.constantFrom(false, false, false, false, false, true),
});

const gamePlan = fc.array(fc.array(playerPlan, { minLength: 5, maxLength: 5 }), {
  minLength: 10,
  maxLength: 10,
});

const TRANSFER_KINDS = ['POT', 'DUEL', 'CUT'] as const;

describe('ADR-0023: invariants for any play', () => {
  it('conserves points, respects the ceilings and the one-big-gamble rule, and replays deterministically', () => {
    fc.assert(
      fc.property(gamePlan, (plan) => {
        const cfg = testConfig({ defaultRounds: 10 });
        const h = new Harness({ config: cfg });
        const ids = h.joinPlayers(5);
        h.start();

        for (const players of plan) {
          if (h.state.phase === 'RESULTS') break;
          h.runUntil('RISK_PICK');
          const scoresBefore = Object.fromEntries(
            ids.map((id) => [id, h.state.game!.players[id]!.score]),
          );
          players.forEach((p, i) => {
            // seat 0 always stays online: a room with nobody connected closes
            if (p.offline && i > 0)
              h.apply({ kind: 'PLAYER_CONNECTION', playerId: ids[i]!, connected: false });
          });
          players.forEach((p, i) => {
            if (!p.risk || h.state.phase !== 'RISK_PICK') return;
            h.command(h.actor(ids[i]!), {
              type: 'COMMIT_RISK',
              payload: {
                stake: p.risk.stake,
                doubleDown: p.risk.doubleDown,
                cover: p.risk.cover,
                pot: p.risk.pot,
                duel: p.risk.duel === null ? null : { targetId: ids[p.risk.duel % ids.length]! },
              },
            });
          });
          players.forEach((p, i) => {
            if (p.reply === 'none' || h.state.phase !== 'RISK_PICK') return;
            for (const challenger of ids) {
              h.command(h.actor(ids[i]!), {
                type: 'RESPOND_DUEL',
                payload: { challengerId: challenger, accept: p.reply === 'accept' },
              });
            }
          });
          if (h.state.phase === 'RISK_PICK') h.runWhile(() => h.state.phase === 'RISK_PICK');
          players.forEach((p, i) => {
            if (!p.sabotage || h.state.phase !== 'SABOTAGE_PICK') return;
            h.command(h.actor(ids[i]!), {
              type: 'COMMIT_SABOTAGE',
              payload: {
                sabotage: {
                  targetId: ids[p.sabotage.target % ids.length]!,
                  effect: p.sabotage.effect,
                  joker: p.sabotage.joker,
                },
              },
            });
          });
          h.runUntil('ANSWERING');
          const round = h.round();

          // Nothing unrevealed in any view, and every view is valid, while the question is open.
          const viewers = [
            { role: 'DISPLAY' } as const,
            ...ids.map((playerId) => ({ role: 'PLAYER', playerId }) as const),
          ];
          for (const viewer of viewers) {
            const view = h.view(viewer);
            expect(RoomViewSchema.safeParse(view).success).toBe(true);
            expect(scanForbiddenKeys(view)).toEqual([]);
            if (view.you) expect(YouViewSchema.safeParse(view.you).success).toBe(true);
          }

          players.forEach((p, i) => {
            if (p.answer === 'none') return;
            h.answer(ids[i]!, p.answer, round.answerOpensAt! + p.offsetMs);
          });
          h.runUntil('SCORE_UPDATE');
          for (const id of ids)
            h.apply({ kind: 'PLAYER_CONNECTION', playerId: id, connected: true });

          const update = h.round().scoreUpdate!;
          const base = h.round().basePoints;
          const kind = h.round().kind;
          const transferred = { POT: 0, DUEL: 0, CUT: 0 };
          for (const entry of update.deltas) {
            // The audit trail reproduces the delta.
            expect(sumComponents(entry.components)).toBe(entry.delta);
            // Nobody goes below zero.
            expect(scoresBefore[entry.playerId]! + entry.delta).toBeGreaterThanOrEqual(0);
            for (const component of entry.components) {
              if ((TRANSFER_KINDS as readonly string[]).includes(component.kind))
                transferred[component.kind as (typeof TRANSFER_KINDS)[number]] += component.points;
            }
            // The own-answer part obeys the ceiling; transfers sit outside it and inside the absolute cap.
            const speed = entry.components
              .filter((c) => c.kind === 'SPEED')
              .reduce((sum, c) => sum + c.points, 0);
            const ownGain = entry.components
              .filter((c) =>
                [
                  'BASE',
                  'STAKE',
                  'SPEED',
                  'DOUBLE_DOWN',
                  'FIFTY_FIFTY',
                  'POINT_TAX',
                  'CAP',
                ].includes(c.kind),
              )
              .reduce((sum, c) => sum + c.points, 0);
            if (ownGain > 0) {
              expect(ownGain).toBeLessThanOrEqual(
                maxTotalMultiplierFor(cfg, kind) * (base + speed),
              );
            }
            expect(entry.delta).toBeLessThanOrEqual(cfg.scoring.maxGainPerQuestion[kind]);
          }
          // Pot, Duel and Cut only move points between players.
          expect(transferred).toEqual({ POT: 0, DUEL: 0, CUT: 0 });

          // One big gamble per question, per player.
          const settlement = h.round().settlement!;
          const inDuel = new Set(
            settlement.duels.filter((x) => x.accepted).flatMap((x) => [x.challengerId, x.rivalId]),
          );
          for (const id of ids) {
            const commitment = h.round().commitments[id];
            const big =
              (commitment && (commitment.stake === 'HIGH' || commitment.stake === 'ALL_IN')
                ? 1
                : 0) +
              (commitment?.doubleDown ? 1 : 0) +
              (inDuel.has(id) ? 1 : 0);
            expect(big).toBeLessThanOrEqual(1);
            // a covered miss never also pays the stake's penalty
            if (commitment?.cover) {
              const entry = update.deltas.find((x) => x.playerId === id);
              const kinds = entry?.components.map((c) => c.kind) ?? [];
              expect(!(kinds.includes('COVER_FEE') && kinds.includes('PENALTY'))).toBe(true);
            }
          }
          // Never the same rival twice in a formed duel.
          for (const id of ids) {
            const rivals = h.state.game!.players[id]!.powers.duelRivals ?? [];
            expect(new Set(rivals).size).toBe(rivals.length);
          }

          for (const id of ids) {
            const gp = h.state.game!.players[id]!;
            expect(Number.isSafeInteger(gp.score) && gp.score >= 0).toBe(true);
            expect(gp.powers.cover!).toBeGreaterThanOrEqual(0);
            expect(gp.powers.cover!).toBeLessThanOrEqual(cfg.powers.cover!.perGame);
            expect(gp.powers.duels!).toBeGreaterThanOrEqual(0);
            expect(gp.powers.duels!).toBeLessThanOrEqual(cfg.powers.duel!.perGame);
            expect(gp.powers.pots!).toBeGreaterThanOrEqual(0);
            expect(gp.powers.pots!).toBeLessThanOrEqual(cfg.powers.pot!.perGame);
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
  }, 120_000);
});
