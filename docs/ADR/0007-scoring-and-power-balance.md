# ADR-0007: Scoring composition, penalties and the 50/50 reward contradiction

Status: Accepted · Date: 2026-10-06

## Context
GDD §7/§13 give example numbers but not a composition rule, and contain a contradiction:
§7.5 says 50/50 should carry a *tradeoff* ("to avoid a free advantage") yet its "simplest version"
makes the correct-answer reward **2× the base value** – a *bonus*. With two of four options removed a
clueless player's chance rises 25 % → 50 %, so doubling the reward would quadruple their expected
value (EV 25 → 100 per 100 base): a dominant, game-breaking power. Penalties for Double Down and Risk
("according to mode rules") are also undefined. The brief requires integer math, explicit rounding,
caps and an auditable delta.

## Decision
All numbers below are **defaults of `GameConfig.scoring`** (zod-validated, versioned, stored with each
game; tunable server-side without an app update, GDD §44).

### Composition (all integer, floors, in this order)
```
base      = round.basePoints                        # STANDARD/SPEED/RISK 100 · FINAL 200
stakeGain = base × tier.multiplier                  # SAFE ×1 · RISK ×2 · HIGH ×3 (FINAL: RISK ×2 · HIGH ×3 · ALL_IN ×5)
speed     = floor(speedMax × remainingMs / answerMs)# speedMax: 100 · SPEED round 200 · FINAL 200
gain      = stakeGain + speed                       # speed is NOT multiplied by the stake (GDD §13 formula)
if doubleDown: gain = gain × 2
if fiftyFifty: gain = floor(gain × 1 / 2)           # ← resolution of the contradiction
if pointTax:   gain = gain − floor(gain × 250 / 1000)   # one-time, consumed on first gain
gain      = min(gain, caps.maxGainPerQuestion)      # 1500 (FINAL 2500)
```
Wrong answer (or unanswered while *connected* with a stake committed – otherwise a risk
commitment could be dropped for free after seeing the question):
```
loss = tier.loss                                    # SAFE 0 · RISK 100 · HIGH 200 (RISK round: 200/300 = symmetric "stake lost")
                                                    # FINAL: RISK 150 · HIGH 250 · ALL_IN 400
if doubleDown: loss = loss + doubleDown.extraLoss    # default +100 (= the base of a standard question)
loss = min(loss, player.score)                      # scores never go below 0
```
Unanswered without a stake, or unanswered while disconnected: delta 0.

### 50/50 resolution
`fiftyFifty.rewardNumerator/Denominator` defaults to **1/2**: the lifeline roughly *halves variance
at constant expected value* for an uncertain player (50 % × ½ ≈ 25 % × 1 + speed), which is the
tradeoff the GDD asks for. The literal "2×" reading is kept reachable as configuration
(`1/1`, `2/1`) for A/B playtests, but is **not** the default. Wrong answers carry no extra penalty
(GDD: "no exploitative extra penalty"). The reduced option pair is chosen once per question and shared
by everyone who uses the power, so players cannot pool two different pairs to expose the answer.

### Other rules
- Powers are limited per game: 50/50 ×1, Double Down ×2 (spent on use, even if wrong).
  A power committed in QUESTION_PREP cannot be withdrawn.
- Streak counter (consecutive correct) drives *earned* sabotage tokens (ADR-0010), not points.
  No rubber-banding: nothing inflates trailing players (GDD §13.2).
- Ranking: score desc → correct answers desc → total `remainingMs` desc → join order. Equal on all
  → shared rank.
- Every delta is a persisted row `score_deltas(game, round, player, delta, total_after, components[],
  config_version)`; `components` lists each step above with before/after values, so any score can be
  reproduced from the audit trail.
- All functions are pure (`packages/game-engine/src/scoring.ts`).

## Consequences
- Balance is data, not code: expect tuning after real playtests.

## Verification
Table-driven boundary tests (0/1/max remaining, each tier, every power combination), fast-check
properties: result is a safe integer; `gain ≤ cap`; delta monotonic in `remainingMs`; `score + delta ≥ 0`;
50/50 never increases gain under defaults; recomputing from `components` equals `delta`.
