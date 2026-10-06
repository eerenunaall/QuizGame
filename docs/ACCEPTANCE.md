# Acceptance matrix (GDD §38)

Legend — **Status**: `TODO` · `WIP` · `PASS` (verified by the named test in this repo) · `PARTIAL`
(logic verified, remainder external) · `EXTERNAL` (cannot be verified in the cloud sandbox; runnable
checklist in `docs/EXTERNAL_CHECKLIST.md`). Status is only changed together with the test that proves it.

| ID | Criterion | Milestone | Proof (test / evidence) | Cloud-verifiable | Status |
|---|---|---|---|---|---|
| A | TV opens without install | M1 | e2e `game.spec.ts` (TV boots from the realtime-served bundle) + ws `static.test.ts` (CSP, headers, caching, SPA fallback) | yes | PASS |
| B | QR appears | M1 | e2e `game.spec.ts` (join QR decodes to the room's join URL) | yes | PASS |
| C | Phone can join | M1 | e2e `game.spec.ts` (three separate browser contexts join) + ws `lobby.test.ts` | yes | PASS |
| D | Different networks work | M7 | red-team ATTACK 12 (phones on different source addresses join and roam mid-game); real WAN external | partly | PARTIAL |
| E | Native app deep link works | M6 | association-file + link-parser tests; device test external | partly | TODO |
| F | Browser fallback works | M1 | e2e `game.spec.ts` (phones are plain browsers, no app) | yes | PASS |
| G | Room lobby is realtime | M1 | ws `lobby.test.ts` › players join in realtime; e2e (TV roster follows joins) | yes | PASS |
| H | Host starts game | M1 | engine `reducer.lobby.test.ts` + e2e (leader starts from the phone) | yes | PASS |
| I | Server owns timer | M1 | engine `reducer.game.test.ts` › answer timing, red-team ATTACK 2/3, ws `recovery.test.ts` | yes | PASS |
| J | Answers lock correctly | M1 | engine `reducer.game.test.ts` › early lock, ws `game.test.ts` | yes | PASS |
| K | Correct answer hidden until reveal | M1 | ws `game.test.ts` (payload scanner on every frame) + engine `views.test.ts` | yes | PASS |
| L | Score is server-owned | M1 | engine `scoring.test.ts` / `reducer.game.test.ts` + red-team ATTACK 1 | yes | PASS |
| M | Power system works (50/50, Double Down) | M2 | engine `reducer.powers.test.ts` (Double Down charges, 50/50 once a game, shared pair, scoring components) + property test + ws `powers.test.ts` + e2e `powers.spec.ts` | yes | PASS |
| N | Risk system works | M2 | engine `reducer.powers.test.ts` (ladders, mandatory stake on the last question, silence while a stake rides) + e2e `powers.spec.ts` (HIGH, final stake) | yes | PASS |
| O | Sabotage system works | M2 | engine `reducer.powers.test.ts` (every rule and effect, shield, softened effects, privacy) + red-team ATTACK 5 + e2e `powers.spec.ts` (blocked and landed sabotage) | yes | PASS |
| P | Game Director works | M2 | engine `director.test.ts` (fast-check: stays inside corridors for arbitrary histories, deterministic, per-kind caps, presets; ADR-0011) | yes | PASS |
| Q | Reconnect works | M2 | ws `reconnect.test.ts`, `client.test.ts`, red-team ATTACK 13, e2e (phone and TV reload mid-game) | yes | PASS |
| R | Host disconnect recovery works | M2 | ws `reconnect.test.ts` › leadership moves after the grace period, display refresh, `recovery.test.ts` | yes | PASS |
| S | Final round works | M1/M2 | engine `reducer.final-stage.test.ts` + e2e (final splash, 2× scoring) | yes | PASS |
| T | Results / rematch work | M1 | e2e `game.spec.ts` (results, podium, rematch) + ws `game.test.ts` › rematch | yes | PASS |
| U | Native purchase can be verified | M4 | integration (verifier code with generated chain / HTTP double); real store external | partly | TODO |
| V | Purchase grants account entitlement | M4 | integration | yes | TODO |
| W | TV sees entitlement without refresh | M4 | ws + e2e | yes | TODO |
| X | Restore purchase works | M4 | integration (flows B, C) | yes (server side) | TODO |
| Y | Question bank imports | M3 | integration `question-import` | yes | TODO |
| Z | Question audit queue works | M3 | integration + admin API | yes | TODO |
| AA | Blind Quiz works | M5 | integration + e2e | yes | TODO |
| AB | Personal answer hidden from creator | M5 | canary test, red-team #10 | yes | TODO |
| AC | Report / moderation controls work | M3/M5 | integration + admin | yes | TODO |
| AD | Red Team suite runs | M7 | `pnpm test:red-team` in CI | yes | TODO |
| AE | No core TODO placeholder remains | M7 | `scripts/release-audit` grep gate | yes | TODO |

## Brief-only gates (final release gate §34)
Monitoring works · backup strategy exists · release checklist exists · browser compatibility
documented · no known critical security issue · purchase verification works · mobile fallback works.
Tracked in `docs/FINAL_RELEASE_AUDIT.md` (generated at M7).
