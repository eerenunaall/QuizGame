# Acceptance matrix (GDD §38)

Legend — **Status**: `TODO` · `WIP` · `PASS` (verified by the named test in this repo) · `PARTIAL`
(logic verified, remainder external) · `EXTERNAL` (cannot be verified in the cloud sandbox; runnable
checklist in `docs/EXTERNAL_CHECKLIST.md`). Status is only changed together with the test that proves it.

| ID | Criterion | Milestone | Proof (test / evidence) | Cloud-verifiable | Status |
|---|---|---|---|---|---|
| A | TV opens without install | M1 | e2e `tv-boot` | yes | TODO |
| B | QR appears | M1 | e2e `lobby-qr` | yes | TODO |
| C | Phone can join | M1 | e2e `join-flow` | yes | TODO |
| D | Different networks work | M7 | ws tests with per-client latency/loss proxy + distinct client IPs; real WAN test external | partly | TODO |
| E | Native app deep link works | M6 | association-file + link-parser tests; device test external | partly | TODO |
| F | Browser fallback works | M1 | e2e `join-flow` (no app) | yes | TODO |
| G | Room lobby is realtime | M1 | ws `lobby-events`, e2e | yes | TODO |
| H | Host starts game | M1 | engine + e2e | yes | TODO |
| I | Server owns timer | M1 | engine timing tests, red-team #2/#3 | yes | TODO |
| J | Answers lock correctly | M1 | engine + ws | yes | TODO |
| K | Correct answer hidden until reveal | M1 | payload-scanner test | yes | TODO |
| L | Score is server-owned | M1 | engine + red-team #1 | yes | TODO |
| M | Power system works (50/50, Double Down) | M2 | engine + e2e | yes | TODO |
| N | Risk system works | M2 | engine + e2e | yes | TODO |
| O | Sabotage system works | M2 | engine + red-team #5 | yes | TODO |
| P | Game Director works | M2 | property tests | yes | TODO |
| Q | Reconnect works | M2 | ws + e2e + red-team #13 | yes | TODO |
| R | Host disconnect recovery works | M2 | ws `host-recovery`, integration crash test | yes | TODO |
| S | Final round works | M1/M2 | engine + e2e | yes | TODO |
| T | Results / rematch work | M1 | e2e | yes | TODO |
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
