# Architecture

Quiz Party: **TV = stage, phone = controller, server = game master.** Details and rationale live in
`docs/ADR/`; this page is the map.

## Repository layout
```
apps/
  realtime/   Node: Fastify HTTP API + ws + room manager + jobs (all authority lives here)
  web/        Vite SPA: /tv display, /game browser controller, /join landing, public pages
  admin/      Vite SPA: content & operations console (server-side RBAC)
  mobile/     Expo React Native controller (iOS + Android)
packages/
  shared/            ids, rng (seeded), time helpers, result/err types, constants
  protocol/          zod schemas: envelope, client→server, server→client, views, error codes
  game-engine/       pure reducer: state machine, timing, scoring, powers, director, selection
  question-schema/   question zod schema, normalization, fingerprints, similarity, audit heuristics
  validation/        nickname/text rules, profanity, deep-link parameter validators
  ui-tokens/         design tokens (TS + CSS variables)
  i18n/              tr/en catalogs + t()
  controller-client/ shared WebSocket client, reconnect, time sync, view store (web + mobile)
  analytics/         telemetry event schemas + sink interface
  db/                migration runner, generated Kysely types, test-database helper
database/migrations/ forward-only SQL
scripts/             question-import, question-audit, seed, gen-*, perf, release-audit, dev
tests/               integration, websocket, e2e, red-team, compatibility, load
infra/               deployment (Dockerfile, compose, fly.toml example), monitoring
docs/                GDD, ADRs, protocol, security, QA, runbooks
```
Dependency direction: `shared ← protocol ← game-engine ← apps/realtime`;
`protocol ← controller-client ← apps/web, apps/mobile`. Engine never imports I/O libraries.

## Runtime flow (happy path)
1. TV opens `/tv` → `POST /v1/rooms` → display session + token; WS `RECONNECT`/attach → `ROOM_STATE`.
2. TV renders QR for `https://<web>/join/<CODE>`; phone opens the link (app if installed, browser otherwise).
3. Phone → WS `JOIN_ROOM{code,nickname,avatar,deviceId}` → `ROOM_JOINED` (session + reconnect token).
4. Leader/host → `START_GAME`; server builds the deck, engine runs; every accepted command is
   appended to `room_events` before ack; views are projected per audience.
5. Timers are server wake-ups (`effects.wake`); clients render countdowns from synced server time.
6. RESULTS → `REMATCH` / `BACK_TO_LOBBY` / `END_ROOM`.

## Deviations from the GDD (ADR-0001 §1)
| GDD says | We do | Why | Intent preserved |
|---|---|---|---|
| §4.2 Next.js recommended | Vite + React SPAs | TV engines from Chromium 85, bundle budgets, no SSR need (ADR-0004) | fast boot, broad TV support, legal pages still static HTML |
| §4.4 Prisma "or equivalent" | Kysely + SQL migrations | Prisma RC, engine downloads, constraint control (ADR-0002) | typed, mature DB access |
| §7.5 50/50 reward 2× | default ½× (configurable) | 2× makes the lifeline dominant (ADR-0007) | "tradeoff to avoid a free advantage" |
| §7.3 risk "before or during" answering | stake committed before the question is shown | avoids "bet when you know it" (ADR-0010) | strategic risk |
| §7.6 six sabotages | five (Noise excluded, behind a flag) | fairness/policy/accessibility (ADR-0010) | "presentation/decision manipulation" |
| §6.7 `ENTITLEMENT_GRANTED` | `ENTITLEMENT_CHANGED` only | one event for grant/restore/refund (ADR-0008) | TV unlocks without refresh |
| §17.3 host = display | display + leader phone | remotes are poor input devices (ADR-0009) | host control separate from ownership |
| §4.1 `tests/` per layer | package unit tests colocated + root `tests/` for cross-cutting layers | ergonomics | all layers exist |
