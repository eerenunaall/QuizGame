# ADR-0010: Powers, risk and the sabotage subset

Status: Accepted · Date: 2026-10-06

## Context
GDD §7.6 lists six sabotage actions, including *Noise* ("misleading visual prompt"), and requires
that sabotage never "corrupt hidden state" or manipulate results, never lock a player out for a
round, never repeatedly target one person, and offer counterplay and an accessibility switch.
GDD §7.3 allows risk "before or during answer commitment"; deciding a stake *after* seeing the
question degenerates into "bet high when you know it".

## Decision
### Risk and Double Down
- Stakes (`SET_RISK`) and Double Down are committed in **QUESTION_PREP only** (category and difficulty
  tag known, question hidden) and are final. Both are rejected from QUESTION onwards.
- Risk ladders are per round kind (ADR-0007). Rounds of kind `RISK` and `FINAL` make the ladder
  prominent; other rounds offer SAFE/RISK/HIGH quietly so the controller stays light.
- Commitments are private until POWER_RESOLUTION.

### 50/50
Used in ANSWERING before the player has answered; the server picks the two removed *incorrect*
options once per question (seeded), sends only the reduced option ids to that player
(`POWER_RESOLVED`), rejects answers for removed options, and consumes the power atomically with the
command (replays are rejected by idempotency + "already used").

### Sabotage (subset)
Implemented: **JAM, SHUFFLE, FOG, LOCKOUT, POINT_TAX**. **NOISE is excluded**: a deliberately
misleading prompt is indistinguishable from content manipulation, creates store/UGC-policy risk and
cannot be made accessible; it stays behind the disabled feature flag `sabotageNoise`.

| Action | Effect (applied at ANSWERING start unless noted) | Bound |
|---|---|---|
| JAM | target's personal cut-off is shortened | min(2000 ms, 15 % of window); never below 80 % of the window |
| SHUFFLE | target's option order is re-shuffled once | no change to correctness |
| FOG | one random option (chosen independently of correctness) is obscured on the target's phone | first 1500 ms only |
| LOCKOUT | target cannot use one chosen joker (50/50 or Double Down) in the **next** round | joker is not consumed |
| POINT_TAX | target's next gain is reduced 25 % | once; expires after 3 rounds |

Rules (all validated by the reducer, all configurable):
- Attacker starts with 1 token, holds ≤ 2, **earns** +1 at correct-streak 3, 6, 9 (agency, not
  rubber-banding). Windows: rounds 3–9 only (not FINAL), QUESTION_PREP only.
- Attacker cooldown 2 rounds; ≤ 2 sabotages per round in total; a target may be hit at most once per
  2 rounds and ≤ 3 times per game; no self-target; target must be an active player;
  LOCKOUT cannot repeat on the same target in consecutive rounds.
- **Counterplay**: every player owns one **Shield** that auto-blocks the first incoming sabotage
  (the attacker's token is still spent). The target phone shows what hit them; the attacker's identity
  is public only at POWER_RESOLUTION.
- **Accessibility**: players with `reducedEffects` have SHUFFLE/FOG resolved as a *half-strength JAM*
  without telling the attacker, so the setting is not disclosed and no one is advantaged by it.
- Sabotage never touches answers, correctness, scores after submission or other players' hidden
  state. Every sabotage is a server record (`sabotage_events`) with actor, target, effect, round.

## Verification
Reducer tests for each rule (spam, replay, cooldown, caps, self-target, shield, lockout chaining),
payload scanner (no sabotage details to non-involved players pre-resolution), property test: with any
sabotage sequence, every active player keeps ≥ 80 % of the answer window and ≥ 2 selectable options.
