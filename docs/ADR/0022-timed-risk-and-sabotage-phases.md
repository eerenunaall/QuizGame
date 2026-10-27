# ADR-0022: Timed RISK and SABOTAGE phases

Status: Accepted · Date: 2026-10-19

## Context
`QUESTION_PREP` mixed stakes, Double Down and sabotage in one short window (6 s, 10 s in RISK and FINAL
rounds). In play-tests people felt rushed: choosing a stake, a joker and a target on one phone screen
before the clock ran out left no room for real competition. Builds on ADR-0005 (state machine), ADR-0010
(powers) and ADR-0021 (power limits); the anti-leak rule is red-team ATTACK 27.

## Decision
1. **Two phases replace one.** `ROUND_INTRO` / `FINAL` → `RISK_PICK` → `SABOTAGE_PICK` → `QUESTION`.
   - `RISK_PICK`: stake (SAFE / RISK / HIGH / ALL_IN) and Double Down, i.e. everything the ladder and the
     jokers decided before. 50/50 stays in ANSWERING (it needs the options); the shield is passive.
   - `SABOTAGE_PICK`: at most one sabotage (attacker, target, type; all ADR-0010 / ADR-0021 limits are
     unchanged), or a confirmed pass.
2. **Intents follow the phases.** `COMMIT_PREP` is replaced by `COMMIT_RISK { stake, doubleDown }` (only
   legal in `RISK_PICK`) and `COMMIT_SABOTAGE { sabotage | null }` (only legal in `SABOTAGE_PICK`). Any
   other phase gets the existing `INVALID_STATE`; no new error code is needed. Each is final, once per
   player and phase (`ALREADY_COMMITTED`), all-or-nothing, and the earlier error codes
   (`STAKE_INVALID`, `DOUBLE_DOWN_STAKE_CONFLICT`, `TARGET_INVALID`, `SABOTAGE_LIMIT`, …) keep their meaning.
3. **Own timers** (all optional in `GameConfig.timings`, read through `riskPickMsFor`,
   `riskPickDecisionMsFor`, `sabotagePickMsFor`, so stored configs still parse): `riskPickMs` 12 000
   (ordinary rounds), `riskPickDecisionMs` 16 000 (RISK and FINAL rounds), `sabotagePickMs` 12 000.
   `prepMs`, `prepQuickMs` and `prepDecisionMs` stay in the schema as unused legacy keys.
4. **A phase is skipped when nobody can act in it**, so no empty screen is ever shown:
   - `RISK_PICK`: nobody online, or a single-rung ladder and nobody holds a Double Down.
   - `SABOTAGE_PICK`: sabotage closed (disabled, first rounds, final stage), or no connected player who
     holds a token, is past the attacker cooldown (`attackerCooldownRounds`) and has a legal target.
5. **Early advance.** `RISK_PICK` ends when every connected player has confirmed. `SABOTAGE_PICK` ends when
   every connected player who *can* sabotage has confirmed (a pass counts); players who cannot are never
   waited for.
6. **Progress is a bare count (ATTACK 27).** `PREP_PROGRESS` and the phase data carry
   `committedCount` / `eligibleCount` only. In `SABOTAGE_PICK` `eligibleCount` is everybody online, not
   only the players who could sabotage, so the table cannot count token holders. The TV draws one tick per
   player, the first `committedCount` filled; ticks are neutral (no avatars), so seating order is shown
   without saying who. Which phone committed what is revealed only in `POWER_RESOLUTION`, as before.
7. **Private per-player state.** `you.sabotage { ready, decided }` (optional) says whether this player
   can sabotage now and whether they confirmed; the phone uses it to show a calm waiting screen to
   players with nothing to choose. `you.commitment` still reports the player's own choices.
8. **TV screens**: a loud title (`RİSK ZAMANI` / `SABOTAJ ZAMANI`, English `RISK TIME` / `SABOTAGE TIME`),
   a 230 px countdown ring, a one-line rule and the tick count. **Phones**: matching screens; the sabotage
   flow (chip → faces → cards → send with a 2 s undo) is unchanged but lives in `SABOTAGE_PICK`, with its
   own countdown and a "no sabotage" button. The question text is never shown on either screen.

## Back-compat
`QUESTION_PREP` stays in the protocol `PHASES` enum and its phase-data schema, never emitted. A state
stored in it is mapped to `RISK_PICK` by `normalizeRecoveredState` (used by room recovery), `phaseDataFor`
shows it as `RISK_PICK`, and both web and mobile clients render a received `QUESTION_PREP` as the risk
screen. Rounds stored without `sabotagePicks` read as having none. An input log written by a build that
still had `COMMIT_PREP` cannot be replayed (the command no longer exists); rooms are short-lived, so a
deploy simply loses those few rooms.

## Consequences
- A round with sabotage takes up to ~12 s longer than before; early advance keeps rooms of decisive
  players quick, and rounds 1–2 and the final stage are unchanged except for the longer risk window.
- Tests: `reducer.picks.test.ts` (order, skipping, timers, early advance, counts, back-compat),
  `reducer.powers.test.ts`, ws `powers.test.ts`, red-team `powers.test.ts` (wrong-phase intents, no leak of
  who committed), web `RiskScreen` / `SabotageScreen` / `TvRiskPick` / `TvSabotagePick`, mobile
  `PickViews.test.tsx`, e2e `picks.spec.ts`.
