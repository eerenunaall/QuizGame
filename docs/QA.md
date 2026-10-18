# Quality assurance

How the game is tested, what each layer proves, and how to run it. The strategy is ADR-0019; the criteria are
`docs/ACCEPTANCE.md`; attacks are `docs/RED_TEAM.md`; performance is `docs/PERF.md`.

## 1. Layers and commands

| Layer | Command | Needs | What it proves |
|---|---|---|---|
| Format, lint, types, unit, web | `pnpm check` | nothing | engine (pure reducer, scoring, director, views, property tests), protocol schemas, packages, scripts, web screens in jsdom |
| Unit only / web only | `pnpm test` / `pnpm test:web` | | |
| Integration | `pnpm test:integration` | PostgreSQL | real SQL: question pipeline, accounts, purchases, personal quizzes, privacy, admin API |
| WebSocket | `pnpm test:ws` | PostgreSQL | real server + real sockets: lobby, game, powers, reconnect, crash recovery, static serving, unlock link, the phone app runtime |
| Red team | `pnpm test:red-team` | PostgreSQL | the attack map (`docs/RED_TEAM.md`) |
| Mobile | `pnpm test:mobile` | | the Expo app's logic and screens (Jest) |
| Browser E2E | `pnpm test:e2e` (builds web+admin first) | PostgreSQL, Chromium at `/opt/pw-browsers/chromium` | real browsers: TV + phones |
| Everything except mobile and e2e | `pnpm test:all` | PostgreSQL | |
| Load / resilience | `pnpm perf --rooms 20 --players 8` | PostgreSQL | latency, memory, reconnect storm (`docs/PERF.md`) |
| Release audit | `pnpm release:audit` | PostgreSQL (for the route inventory) | mechanical release criteria; writes `docs/FINAL_RELEASE_AUDIT.md` |

Sandbox start-up: `pnpm install`, `pnpm dev:db` (PostgreSQL 16, creates `quizparty_dev`), `pnpm db:migrate`. Never run
`playwright install` (Chromium is preinstalled and Playwright is pinned to match).

The local gate before a push is `format -> lint -> typecheck -> unit -> web -> integration -> websocket -> red-team`, then
`pnpm run build:web && pnpm run build:admin && pnpm test:e2e`. CI runs the same jobs plus the mobile job and an Expo export smoke
(`.github/workflows/ci.yml`); after every push read the CI result and fix red before moving on.

## 2. Rules

- The tests use the production code paths: real PostgreSQL, real WebSockets. Doubles exist only for remote systems (Apple, Google,
  model providers, SMTP) and speak the real wire contract.
- Every bug gets a regression test first. A flaky test is fixed, never skipped.
- A payload scanner reads every frame in the websocket and red-team suites and fails on forbidden keys (unrevealed answers, other players' powers).
- E2E rule: never assert on a phase shorter than about 1.2 s and never on a transient phase after a sleep; wait for the next phase's lasting marker.

## 3. What the sandbox can and cannot prove

Taken from ADR-0019 and extended by the measurements.

Proven here: server authority, timing, scoring, protocol security, reconnect, crash recovery, database constraints, payment verification
logic against doubles speaking the real wire formats, the question pipeline, Blind Quiz privacy, accessibility basics, behaviour under
simulated load on loopback.

Not provable here (each is `EXTERNAL` in the audit): real-network latency and NAT, physical phones and TVs, Safari/Firefox/Edge engines,
store sandboxes, signed builds, app-link domain association, SMTP delivery, model-based fact checking, Docker image build, TLS/CDN.

## 4. Manual QA before a release

Use `docs/RELEASE_CHECKLIST.md` (it contains the manual game pass, the device pass link `docs/BROWSER_MATRIX.md` and the mobile pass
`docs/MOBILE.md`). Question quality has its own process (`docs/QUESTION_QUALITY.md`, review queue in the console).

## 5. Test inventory

The counts live in `docs/STATUS.md` ("Test inventory"); do not copy them elsewhere. The acceptance matrix names the file that proves each criterion.
