# ADR-0023: New risks and sabotages — Cover, Duel, Pot, Stake Cap, Cut, Blind Clock

Status: Accepted · Date: 2026-10-19
Builds on: ADR-0007 (scoring), ADR-0010 (powers), ADR-0021 (one big gamble), ADR-0022 (timed pick phases).
Spec: the shortlist of `docs/RISK_SABOTAGE_RESEARCH.md` (section 5), with the numbers of its sections 3 and 4.
Names: TR Örtü, Düello, Havuz, Bahis Sınırı, Kesme, Kör Saat; EN Cover, Duel, Pot, Stake cap, Cut, Blind clock.

## Context
Sabotage was almost all time and perception (JAM, SHUFFLE, FOG) and the only risk beyond the ladder was
Double Down. The research proposed seven risks and seven sabotages; the owner approved the shortlist
(Cover, Duel, Pot; Stake Cap, Cut, Blind Clock) and answered the open questions with defaults. This ADR
records the rules as built, every decision the research left open, and the deliberate deviations.

## What was built
| Item | Phase | One-line rule (defaults) |
|---|---|---|
| **Cover** (risk) | RISK_PICK | Pay half of the stake's loss now (RISK 50, HIGH 100, ALL_IN 200). A wrong or missing answer then loses nothing else. 1 per game. Only on a stake with something to lose. |
| **Duel** (risk, opt-in both sides) | RISK_PICK | Challenge one rival; they accept or decline in the same phase. If accepted: exactly one of you right, 80 points move; both right, the faster takes 40; both wrong, nothing. 2 challenges per game. |
| **Pot** (risk) | RISK_PICK | Ante 30. Everybody who anted, was still there and is right splits the pot; the remainder goes to the fastest. Needs 3 players; nobody right or too few: antes back. 2 per game. |
| **Stake Cap** (sabotage) | SABOTAGE_PICK | The target's highest stake in the next question is RISK. |
| **Cut** (sabotage) | SABOTAGE_PICK | 20 % of the target's next gain (at most 30) goes to the attacker. Lapses after 3 rounds like POINT_TAX. |
| **Blind Clock** (sabotage) | SABOTAGE_PICK | The target's phone hides its countdown for the question; the TV's clock stays. |

## Decisions on the research doc's open questions (section 6)
1. **Item budget**: all six ship; each has its own switch (`powers.<name>.enabled`, below). The second wave
   (Two-Step, Trim, Steam, Mirror, Spotlight, Backer, Herd, Rush) is not built.
2. **Duel is opt-in for both sides.** The challenger picks one rival in RISK_PICK; the rival accepts or
   declines in the same phase (`RESPOND_DUEL`). No reply by the end of the phase = declined; nothing happens.
3. **Small rooms**: Duel works from 2 players (`duel.minPlayers` 2); Pot needs 3 (`pot.minPlayers` 3), because
   its own rule is "at least three in the pot".
4. **Tokens**: one sabotage token for everything; no cheaper tier for Blind Clock.
5. **Cut and the leader**: Cut can never target the current rank 1 (players tied for first share the
   protection), nor a player with no points; it keeps the existing cooldown, per-target gap, per-round and
   per-target limits. Consequence worth knowing: in a two-player room the trailing player can never Cut the
   leader, while the leader may Cut the trailing one. Switch Cut off (`powers.cut.enabled`) where that is unwanted.
6. **Mirror**: not built (second wave). The shield is unchanged.
7. **Withdrawable commits**: no; ADR-0007 stands (every commit is final).
8. **Prep length**: unchanged; ADR-0022 already gave stakes and sabotage a window each.
9. **Public stake before reveal**: nothing new becomes public before POWER_RESOLUTION (Spotlight is not built).
10. **Ceiling and flat bonuses**: Cover and the Cut/Pot/Duel transfers sit outside the multiplier chain (see the
    pipeline below); the 3x (FINAL 5x) ceiling and `maxGainPerQuestion` keep governing the answer's own gain.
11. **Tone**: names as proposed; "Cut" is the one a family venue may switch off.
12. **Reduced effects**: Blind Clock does not replace the half-JAM fallback for SHUFFLE and FOG (that behaviour
    is unchanged). Blind Clock itself applies in full to everybody: it moves nothing and costs no time.
13. **Evidence**: the web research was not re-run (no network in the sandbox); the balance numbers are the doc's.

## Interaction table: one big gamble per question
BIG = HIGH, ALL_IN, Double Down, Duel (as challenger *or* as the rival who accepted). A player holds **at most
one** BIG item per question. Cover and Pot are small items. RISK is not big.

| Combination | Legal? | Refusal |
|---|---|---|
| HIGH / ALL_IN + Double Down | no | `DOUBLE_DOWN_STAKE_CONFLICT` (ADR-0021) |
| Duel + HIGH / ALL_IN (`duel.excludedStakes`) | no | `BIG_GAMBLE_CONFLICT` |
| Duel + Double Down | no | `BIG_GAMBLE_CONFLICT` |
| Accepting a Duel after taking HIGH / ALL_IN / Double Down, or after challenging somebody else (unless it is each other) | no | `BIG_GAMBLE_CONFLICT` |
| Taking HIGH / ALL_IN / Double Down after accepting a Duel | no | `BIG_GAMBLE_CONFLICT` |
| Accepting a second Duel | no | `DUEL_LIMIT` |
| Cover on SAFE (nothing to lose) | no | `STAKE_INVALID` |
| Cover + Double Down | no by default | `BIG_GAMBLE_CONFLICT` (`cover.allowWithDoubleDown`, default false) |
| Cover + HIGH / ALL_IN / RISK, Cover + Duel, Cover + Pot | yes | |
| Pot + anything | yes | |
| RISK + Double Down (3x ceiling applies) | yes | |
| Any stake above `stakeCap` on a capped player | no | `STAKE_INVALID` |

Why Cover and Double Down exclude each other: Cover waives the whole loss, including Double Down's extra 200.
RISK + Double Down + Cover would pay up to 450 against a worst case of 50: the nearly risk-free stack ADR-0021
removed. Allowing it by config waives the extra loss too, as the research text says.

Every row is enforced in `checkRisk` / `checkDuelReply` (server side, before anything is spent) and mirrored in
both phone UIs, which grey the button with a one-line reason. `reducer.risks.test.ts` walks all 48 stake ×
Double Down × Cover × Pot × Duel combinations against this table; the property test asserts no player ever holds
two BIG items.

## Settlement at lock (pure functions in `risks.ts`, wiring in `reducer.ts`)
1. **Pot first**: the antes are taken before any score is computed, so a lost stake can never leave the ante
   unpaid. A player is in the pot if they anted and either answered or are online at lock; the pot runs with
   at least `pot.minPlayers` of them. Nobody right, or too few: nobody pays, and the use is given back.
2. **Own score** (`computeScore`): base, stake, speed, Double Down, ceiling `CAP`, 50/50, POINT_TAX, the
   `maxGainPerQuestion` cap, then **Cut** (a share of what the player really gains, ceiling 30) and the **Cover
   fee**. Cover on a miss replaces the PENALTY with the fee. Every step is a component, so the audit trail adds up.
3. **Pot payout**, then **Duels** (in the order they were challenged), each capped by the loser's running
   balance. Components: `POT` (the net), `DUEL` (+/-), `CUT` (+ for the attacker, - for the target),
   `COVER_FEE`. Nobody ends below zero.
Transfers are outside the multiplier ceiling by design and conserve points: the property test asserts that the
`POT`, `DUEL` and `CUT` components of a round sum to zero, and that the own-answer part never exceeds
`maxTotalMultiplier x (base + speed)`. They are not clamped by `maxGainPerQuestion`; with the defaults the worst
case (ceiling gain + pot of 8 + a Duel + two Cuts) stays under it in every round kind (950 of 1500 for STANDARD,
2350 of 2500 for FINAL), and the property test checks it for random play.

## Rules in detail
- **Cover**: fee `floor(loss x feePermille / 1000)`, capped by the player's points. A connected player's missing
  answer is a miss; an offline player's is not (ADR-0007), so they pay neither the loss nor the fee. The use is
  spent on commitment either way.
- **Duel**: spent when sent, accepted or not (a declined challenge costs the use; `perGame` 2). A pair that
  *fought* is never matched again, in either direction (`duelRivals`). Several players may challenge the same
  rival; the rival accepts at most one. Two challenges aimed at each other form a duel with no reply. An
  unanswered duel counts as wrong for either side, even for a challenger who disconnected (the research's "cannot
  dodge"). Speed is the answer's offset into the window, so a JAM does not decide a Duel. A challenge to the
  **author of a Who Said It statement** is accepted silently and never answered: refusing it would name the
  answer (ATTACK 27); the TV shows it as declined at POWER_RESOLUTION, after the reveal. A rival must be online
  when challenged (the roster shows it, so the refusal tells nothing).
- **Pot**: players in the pot are public only at POWER_RESOLUTION (the research's "Pot 90 (3 players)" before
  the answer was not built: the TV shows no pot count before resolution). The ante must be in hand (score >= 30),
  so Pot is unavailable in the first round.
- **Stake Cap**: lands on the question after the hit and lapses after it. It is not on the menu (and a commit is
  refused with `SABOTAGE_LIMIT`, token not spent) when the next question is in the final stage or when no ordinary
  ladder has a rung above the cap. The target learns in that question's RISK_PICK (`you.powers.stakeCap`); the
  public ladder is the same for everybody. The shield blocks it.
- **Cut**: pending on the target, consumed by their first gain, lapses after `cut.rounds` (3) rounds without
  one. Taken after POINT_TAX and the caps. Never on a target who already carries a Cut or a POINT_TAX (one
  economy hit at a time; the reverse is refused too). If the attacker leaves the game it lapses; if the attacker
  sits the question out as a Who Said It author, it waits for a later gain. The shield blocks it.
- **Blind Clock**: `you.effects.blindClock`; presentation only, the window and the scoring are unchanged and the
  server enforces nothing (a modified client only removes the prank). The shield blocks it.

## Config (`GameConfig`, version 3)
All optional with defaults, read through `coverRules`, `duelRules`, `potRules`, `stakeCapRules`, `cutRules`,
`blindClockRules`, so snapshots stored before this ADR parse and play with everything on. Each object has
`enabled` plus its numbers; a venue overrides one switch with
`GAME_CONFIG_OVERRIDE='{"powers":{"duel":{"enabled":false}}}'`.
`cover {enabled, perGame 1, feePermille 500, allowWithDoubleDown false}` ·
`duel {enabled, perGame 2, win 80, bothRight 40, excludedStakes [HIGH, ALL_IN], minPlayers 2}` ·
`pot {enabled, perGame 2, ante 30, minPlayers 3}` · `stakeCap {enabled, maxTier RISK}` ·
`cut {enabled, permille 200, maxPoints 30, rounds 3}` · `blindClock {enabled}`.
A feature switched off at the start of a game is simply not in that game (its counter is 0); a game stored
before this ADR has no counters, so none of the risks exist in it. RISK_PICK is still skipped when nobody can
choose a stake or Double Down; the extras alone do not open it.

## Protocol (docs/PROTOCOL.md)
`COMMIT_RISK { stake, doubleDown, cover?, pot?, duel?: { targetId } | null }`; new `RESPOND_DUEL { challengerId,
accept }` (RISK_PICK only; `POWER_UNAVAILABLE` for a challenge that was not made to you, `ALREADY_COMMITTED` for a
second reply); errors `BIG_GAMBLE_CONFLICT`, `DUEL_LIMIT`; `SABOTAGE_KINDS` += `STAKE_CAP`, `CUT`, `BLIND_CLOCK`;
score components += `COVER_FEE`, `POT`, `DUEL`, `CUT`; `RISK_PICK` phase data `risks` and `riskLadder[].coverFee`;
`SABOTAGE_PICK` phase data `offered` (the menu) and `cutRule`; `you.powers.{cover,duel,pot,stakeCap}`,
`you.commitment.{cover,pot,duel}`, `you.duelInvites`, `you.effects.blindClock`; POWER_RESOLUTION items `COVER`,
`POT`, `DUEL`, `CUT`. Everything new is optional so older clients and servers interoperate. Migration 0008 widens
the `sabotage_events.effect` check.

## Privacy (ADR-0008, ATTACK 27)
Before POWER_RESOLUTION the TV and every other phone learn only counts. A challenge, Cover and Pot are private to
the player who chose them; a Duel invite goes to the challenged player alone, with the challenger's name. The one
side effect is that RISK_PICK counts a player as done only when they have confirmed *and* have no open
invitation, so the tick count can fall by one when a challenge lands on somebody who was done: a count, with no
who. The menu `offered` is config, the same for everybody, and names nobody. `PREP_PROGRESS` is unchanged.
`onTick` now also ends a pick phase early when a player it was waiting for has dropped.

## Consequences
- Tests first, per feature: `scoring.risks.test.ts`, `risks.test.ts` (pure rules, EV), `reducer.risks.test.ts`
  (rules, caps, edge cases, interaction table, Who Said It, blind deck, old snapshots),
  `reducer.sabotage-new.test.ts`, `reducer.risks.property.test.ts` (conservation, ceilings, one big gamble,
  views valid and scanner-clean, replay); web `RiskExtras`, `SabotageNew`, `power` tests; mobile
  `PickViews.risks`; controller-client `powers.test.ts`; ws `risks.test.ts`; red-team `risks.test.ts`
  (ATTACK 35); e2e `risks.spec.ts`.
- Not verified here: balance in real play (only the research doc's arithmetic and the property tests); the
  icons were checked in screenshots, not by a designer; the native app was exercised with Jest only (no device).
- Unchanged on purpose: `QUESTION_PREP` handling, the shield, the token economy, JAM / SHUFFLE / FOG / LOCKOUT /
  POINT_TAX, and the final stage (no sabotage; Cover, Duel and Pot are allowed in it, Stake Cap never reaches it).
