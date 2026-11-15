# ADR-0021: Power limits — one big gamble per question

Status: Accepted · Date: 2026-10-18

## Context
Live play showed that stakes (HIGH ×3, FINAL ALL_IN ×5) stacked with Double Down and 50/50 made a
nearly risk-free huge win: STANDARD, HIGH + Double Down paid (300 + 100) × 2 = **800** against a normal
gain of ~200, while a miss cost only 200 + 100 = **300**. The owner likes the gambling and wants a
clear limit, not less fun. Builds on ADR-0007 (composition) and ADR-0010 (powers).

## Decision (all in `GameConfig`, tunable through `GAME_CONFIG_OVERRIDE`; version 2)
1. **One big gamble per question.** `powers.doubleDownExcludedStakes` (default `['HIGH','ALL_IN']`):
   Double Down cannot go with those stakes. `COMMIT_PREP` (now `COMMIT_RISK`, ADR-0022) is refused with
   `DOUBLE_DOWN_STAKE_CONFLICT` before anything is spent (all-or-nothing, like every prep rule). The
   prep view carries the list (`doubleDownExcludedStakes`), and both phone UIs disable the Double Down
   button when an excluded stake is picked and disable the excluded stakes once Double Down is on,
   with a short hint. 50/50 and the shield are unchanged (50/50 only ever lowers a gain).
2. **Total multiplier ceiling (backstop).** `scoring.maxTotalMultiplier` per round kind
   (STANDARD/SPEED/RISK/CROWD 3, FINAL 5): after the stake and Double Down steps,
   `gain <= ceiling × (base + speed)`. The excess is recorded as a `CAP` component, so the audit trail
   still sums to the delta. `maxGainPerQuestion` stays as the absolute cap. With the exclusion on, the
   ceiling bites for RISK + Double Down on STANDARD (2 × 2 = 4× becomes 3×) and protects against
   config overrides that empty the exclusion list.
3. **Fairer Double Down loss.** `doubleDown.extraLoss` 100 → **200**.
4. Both new schema fields are optional and read through `maxTotalMultiplierFor` /
   `doubleDownExcludedStakes`, which fall back to the defaults, so room snapshots stored before this
   change still parse.

## Arithmetic (STANDARD: base 100, speed 0..100, mean speed 50)
Double Down alone, SAFE: win = 2 × (100 + 50) = **300**, loss = extraLoss.
Break-even accuracy `p = loss / (win + loss)`:

| extraLoss | SAFE | RISK (win capped at 3 × 150 = 450, loss 100 + extra) |
|---|---|---|
| 100 (old) | 100 / 400 = 25 % | 200 / 650 = 31 % |
| **200** | 200 / 500 = **40 %** | 300 / 750 = **40 %** |
| 250 | 250 / 550 = 45 % | 350 / 800 = 44 % |

200 lands both at 40 % (a property test pins the range 38–45 %). Owner example after the change:
HIGH + Double Down is refused; the best legal stack, RISK + Double Down at full speed, pays 600 with a
miss costing 100 + 200 = 300 (2:1, the break-even above), and nothing ever pays more than 3 × (base +
speed). FINAL: ALL_IN + Double Down is refused; RISK + Double Down is under the 5× ceiling.

## Consequences
- Tests: `scoring.test.ts` (ceiling for any input, break-even band), `reducer.powers.test.ts`
  (exclusion both ways, no spend on refusal, config-driven), websocket `powers.test.ts` (illegal
  `COMMIT_PREP` gets `DOUBLE_DOWN_STAKE_CONFLICT`), `PrepScreen.test.tsx`.
- Tuning: set `powers.doubleDownExcludedStakes` to `[]` to allow every pair again, or raise
  `scoring.maxTotalMultiplier`.
