# ADR-0005: Game state machine semantics

Status: Accepted · Date: 2026-10-06

## Context
GDD §8 lists 16 states and a flow but not what separates `QUESTION` from `ANSWERING`, how `FINAL`
fits, what `REMATCH` is, what happens when the display is lost, or whether players may join late.

## Decision
The engine (`packages/game-engine`) is a **pure reducer**: `reduce(state, input) → { state, effects, result }`.
Inputs carry the server time `at`; there is no I/O, no `Date.now()` and no `Math.random()` (a
serializable seeded PRNG lives in the state). Effects are data (`emit`, `wake`); the realtime
server interprets them.

### Phases and transitions
| Phase | Meaning | Leaves when |
|---|---|---|
| WAITING | room exists, display attached, nobody joined | first player joins → LOBBY |
| LOBBY | players join, ready up, host picks settings | host `START_GAME` (validated) → COUNTDOWN |
| COUNTDOWN | 3-2-1 | timer → ROUND_INTRO |
| ROUND_INTRO | "ROUND n · base pts · round kind" | timer → QUESTION_PREP |
| QUESTION_PREP | category + difficulty tag shown, **question hidden**; private stake/power/sabotage commitments | timer or all active players committed → QUESTION |
| QUESTION | question **text** presented on the TV (reading beat, 2–5 s from text length); options not yet delivered | timer → ANSWERING |
| ANSWERING | options delivered, answer window open (`answerOpensAt` … `answerDeadlineAt`) | deadline passed or every eligible player answered → LOCKED |
| LOCKED | input closed; server computes outcomes privately (nothing sent) | timer (≈1 s) → REVEAL |
| REVEAL | correct option, distribution, per-player correct/incorrect | timer → POWER_RESOLUTION (skipped if no power/stake/sabotage was used) |
| POWER_RESOLUTION | public reveal of who staked/doubled/sabotaged whom | timer → SCORE_UPDATE |
| SCORE_UPDATE | `SCORE_DELTA` + `SCOREBOARD` released | timer → MICRO_INTERMISSION (or RESULTS after the last round) |
| MICRO_INTERMISSION | short teaser of the next round | timer → NEXT_ROUND |
| NEXT_ROUND | transient: Director runs, next question chosen | immediately → ROUND_INTRO, or FINAL for the last round |
| FINAL | dramatic rule-change intro for the last round | timer → QUESTION_PREP (round kind `FINAL`) |
| RESULTS | podium + stats | host `REMATCH` → COUNTDOWN, `BACK_TO_LOBBY` → LOBBY, `END_ROOM`/idle → ROOM_CLOSED |
| ROOM_CLOSED | terminal | — |

- `FINAL` is the intro to a normal question cycle whose `round.kind === 'FINAL'` (different scoring,
  mandatory stake, no sabotage). It is not a separate question loop, so no code is duplicated.
- The reading beat exists so that nobody gains time by reading faster on a phone and so the TV can
  stage the question; **it is the only deliberate delay before input opens** (GDD §29.2).
- Early lock: `ANSWERING → LOCKED` as soon as every *eligible* player has answered. Eligible =
  active players who are connected, or disconnected for less than `earlyLockGraceMs` (4 s).
- `REMATCH` keeps players, creates a new `gameId`, resets scores/powers, rebuilds the deck and goes
  straight to COUNTDOWN. `BACK_TO_LOBBY` keeps players and settings but returns to LOBBY.
- **Late join**: after `START_GAME` new `JOIN_ROOM` requests are rejected (`GAME_IN_PROGRESS`).
  Known sessions reconnect normally. Rejected joiners are shown a spectate-less waiting screen with
  the room's next-game hint.
- **Display loss**: timers never wait for the display (it is a renderer). If the display is absent
  longer than `displayGraceMs` (20 s) during a game, the room holds at the next boundary
  (before ROUND_INTRO) with `awaitingDisplay = true` until a display re-attaches; if that lasts
  `abandonMs` (10 min) the room closes with results preserved as *interrupted*.
- **Idle**: LOBBY idle 30 min, RESULTS idle 10 min, absolute room lifetime 6 h → ROOM_CLOSED.
- Illegal transitions are impossible by construction: `reduce` has an exhaustive switch over
  `(phase, input)`; a property test drives random input sequences and asserts invariants
  (monotonic `version`, scores ≥ 0, one answer per player per round, no answer after lock).

### Host authority
See ADR-0009 (display + leader). UI code never advances the game: it submits intents only.

## Consequences
- Every duration is a field of `GameConfig.timings` (ADR-0007 table) so playtests tune the pacing
  without code changes; a full 10-round game defaults to ≈ 6 minutes.

## Verification
Exhaustive transition table test; random-walk invariant property test; full-game scripted test.
