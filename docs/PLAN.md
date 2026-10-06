# Master plan

Milestones close only when tests + typecheck + lint + build are green and `docs/STATUS.md` is updated.
Order differs from GDD §40 in one respect: backend-verifiable subsystems (payments, content, blind)
precede the native app because the sandbox cannot run native binaries (ADR-0017). The first
end-to-end slice (GDD §33) comes before any optional system.

## M0 — Foundations
Monorepo (pnpm/turbo/TS strict/ESLint/Prettier/Vitest), env schema, CI, `.env.example`, DB migration
runner + test-database helper, docker-compose for Postgres/Redis, `scripts/dev/*` for the sandbox.
**Exit:** `pnpm check` green on empty packages; CI green on the remote branch.

## M1 — Real playable slice (GDD §33)
- M1a `shared`, `protocol`, `game-engine` (state machine, timing, base scoring, final round, views) with
  exhaustive unit + property tests.
- M1b migrations 0001/0002 (rooms, sessions, events, questions), `apps/realtime`: HTTP + WS, sessions,
  rooms, durable event log, question deck from DB, outbound validation, payload-scanner test.
- M1c `apps/web`: `/tv` (QR lobby → full game → results → rematch) and `/game/:code` browser
  controller; dev seed questions; Playwright E2E with 1 TV + 3 phone contexts.
**Exit:** acceptance A–C, F–L, S, T proven by tests; E2E green in CI.

## M2 — Party mechanics and resilience
50/50, Risk, Double Down, Sabotage (+Shield, accessibility), Game Director, round kinds
(SPEED/RISK/CROWD), reconnect + token rotation, leader migration, display pairing, display-loss hold,
crash recovery (time freeze), idle/lifetime closing, per-IP/session rate limits.
**Exit:** acceptance M–R proven; red-team #1–8, #13, #14 green.

## M3 — Content factory and admin
Question schema/normalization/fingerprints, importer, audit pipeline (heuristics + LLM adapters),
dev seed (≥ 170 TR questions), reports/moderation, admin API (RBAC) + admin SPA (questions, review
queue, reports, categories, current events, users, entitlements, rooms, bans, flags, incidents),
feature flags, telemetry.
**Exit:** acceptance Y, Z, AC proven.

## M4 — Accounts and payments
Email-OTP auth, sessions, account deletion/export, purchase verification (Apple/Google), entitlements,
restore, webhooks (refund/revoke), link intents (TV↔phone), free-tier enforcement, `ENTITLEMENT_CHANGED`.
**Exit:** acceptance U–X proven (logic), flows A/B/C green, payment red-team green.

## M5 — Blind Quiz, Who Said It, Custom Quiz (flagged)
Vault + encryption, invite/response flow, approval gate, deck integration, retention job, canary
tests, AI decoy adapter (flagged), Who Said It, minimal Custom Quiz.
**Exit:** acceptance AA, AB proven.

## M6 — Mobile
Expo app: Home, Join, deep links, Lobby, Question, Joker, Risk, Sabotage, Reconnect, Results,
Purchase, Profile shell; `controller-client` shared; association files; Jest suite.
**Exit:** typecheck/lint/Jest green; `expo export` smoke; acceptance E partial (rest external).

## M7 — Polish, hardening, release
Animation/sound/accessibility pass with screenshot reviews, error UX, perf measurements, load test,
browser/viewport matrix, red-team suite consolidation (`tests/red-team` ATTACK 1–14 + extras),
`docs/*` completion (PROTOCOL, SECURITY, QA, DEPLOYMENT, BACKUP, RUNBOOK, RELEASE_CHECKLIST,
BROWSER_MATRIX, EXTERNAL_CHECKLIST, PRIVACY), `scripts/release-audit`, `FINAL_RELEASE_AUDIT.md`.
**Exit:** every criterion PASS or documented EXTERNAL with its blocking dependency.

## Standing activities
After each subsystem: attacker pass (red team). After each push: read CI result and fix before moving
on. Keep `CLAUDE.md` and `docs/STATUS.md` accurate for the next session.
