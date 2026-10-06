# ADR-0019: Test strategy and what the environment can prove

Status: Accepted · Date: 2026-10-06

## Decision
### Layers (GDD §36, brief §25)
| Layer | Tooling | Location | Needs |
|---|---|---|---|
| Unit | Vitest, fast-check | `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts` | none |
| Integration | Vitest + real PostgreSQL (template DB per file) | `tests/integration` | Postgres |
| WebSocket | Vitest + `ws` clients against an in-process server | `tests/websocket` | Postgres |
| E2E | Playwright (Chromium, several contexts: 1 TV + N phones) | `tests/e2e` | Postgres + built web |
| Mobile | Jest (jest-expo) + Testing Library | `apps/mobile` | none |
| Compatibility | Playwright viewport/capability matrix, `es-check`, `size-limit` | `tests/compatibility` | built web |
| Red Team | Vitest against a real server + DB | `tests/red-team` | Postgres |
| Load/perf | Node scripts with many `ws` clients; Playwright traces | `tests/load`, `scripts/perf` | Postgres |

Rules: tests use the same code paths as production (real DB, real WebSocket); doubles exist only for
*remote* systems that cannot be reached (Apple/Google/LLM/SMTP endpoints) and implement the same wire
contract; every bug becomes a regression test before the fix; flaky tests are fixed, never skipped.

### What the sandbox can and cannot prove (reported verbatim in the final audit)
- ✔ Server authority, timing, scoring, protocol security, reconnect, crash recovery, DB constraints,
  payment verification *logic*, question pipeline, Blind Quiz privacy, accessibility basics, perf
  budgets on this machine, current-Chromium behaviour at 720p/1080p/4K.
- ✘ Real cross-network latency and NAT behaviour, physical phones/TVs/consoles, Safari/Firefox/Edge
  engines (only Chromium is installed), store sandboxes, signed native builds, universal-link domain
  association, SMTP delivery, LLM-based fact checking, Docker image build (no daemon), CDN/TLS.
  Each is tracked as `EXTERNAL` in `docs/ACCEPTANCE.md` with the exact missing dependency and a
  runnable checklist for whoever has it.

### CI
GitHub Actions: `check` (lint, typecheck, unit, protocol/types drift), `integration` (Postgres 16
service), `e2e` (Playwright Chromium install), `build` (apps, bundle budgets, legacy-bundle parse).
After each push the session reads the run result through the GitHub API and fixes failures before
continuing.

### Environment performance targets (measured by `scripts/perf`, reported in `docs/perf/`)
First meaningful TV render ≤ 1.5 s (local), QR visible ≤ 2 s, room join ≤ 300 ms (local), WS connect
≤ 150 ms (local), input→lock ack ≤ 100 ms p95 (local, 8 players), reconnect ≤ 2 s, question
transition without dropped frames in the trace, TV heap growth ≤ 20 MB over a 10-round game.
Local numbers are budgets for regressions, not claims about production networks.
