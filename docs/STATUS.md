# Status (update at the end of every milestone and before ending a session)

Branch: `claude/cloud-session-infrastructure-ln57mp` · Last updated: 2026-10-06

## Milestones
| Milestone | State | Notes |
|---|---|---|
| Planning (ADR-0001…0020, PLAN, ACCEPTANCE, AUDIT) | DONE | contradictions resolved, see ADRs |
| M0 Foundations | DONE | pnpm/turbo/TS strict/ESLint/Prettier/Vitest, CI, DB runner, test DB helper |
| M1a protocol + engine | DONE | pure reducer, scoring, director, views, final stage; unit + property tests |
| M1b database + realtime | DONE | HTTP + WS, sessions with token rotation, durable event log with fencing, crash recovery, rate limits, static web serving with strict CSP |
| M1c web TV + browser controller | DONE (CI green: check, integration, e2e) | `/tv` (QR lobby → game → results → rematch), `/join`, `/game`, settings (rounds, difficulty, categories), lobby tools for the leader, English + Turkish, synthesized sound, animated art; Playwright E2E with real Chromium |
| M2 Party mechanics & resilience | DONE (CI result of the latest push: see "Next actions") | reconnect, token rotation, leader migration, display grace, crash recovery, rate limits (M1b) plus a prep phase with stakes, Double Down, 50/50, sabotage (JAM / SHUFFLE / FOG / LOCKOUT / POINT_TAX) with shield, token earning, cooldowns and softened effects, CROWD reveal, POWER_RESOLUTION screen, persistence of power use (migration 0003), ATTACK 5 closed |
| M3 Content factory & admin | TODO | |
| M4 Accounts & payments | TODO | |
| M5 Blind Quiz & friends | TODO | |
| M6 Mobile | TODO | |
| M7 Polish, hardening, release | TODO | |

## Test inventory (all run locally and in CI)
| Layer | Command | Count |
|---|---|---|
| unit (packages, realtime, scripts) | `pnpm test` | 317 |
| web (jsdom: router, storage, device, remote navigation, i18n coverage, audio, screens, prep + power screens) | `pnpm test:web` | 79 |
| integration (PostgreSQL) | `pnpm test:integration` | 18 |
| websocket (real server, real sockets) | `pnpm test:ws` | 54 |
| red team (ATTACK 1–14 map in `docs/RED_TEAM.md`) | `pnpm test:red-team` | 31 (+2 todo for the M4/M5 attacks) |
| browser E2E (real Chromium: 1 TV + 3 phones, reloads, drops, QR decode, remote keys, every power) | `pnpm test:e2e` | 14 |

The local gate is `format → lint → typecheck → unit → web → integration → websocket → red-team`,
then `pnpm run build:web && pnpm test:e2e`.

## Next actions
1. Read the CI result of the latest push (`mcp__github__actions_list`) and fix anything red.
2. M3: question schema + normalisation + duplicate detection, importer and audit CLIs, migration 0004
   (audits, reports, usage, flags, admin users and roles, bans, incidents), ≥ 170 hand-written TR
   seed questions, reports/moderation, admin API (RBAC) + admin SPA, feature flags, telemetry.
3. M4: OTP auth, Apple/Google receipt verification (ports + fakes), entitlements, TV linking, free tier.

## Known issues / decisions pending
- Polyfill chunk is 44 kB gzip; narrowing the browser target would shrink it (decide after a TV
  matrix run, M7).
- The static web server runs inside the realtime process (fine for one instance; put a CDN in front
  for production, see ADR-0003).
- Art is Fluent Emoji / Noto Emoji (permissive licences, credits page included). Swap for commissioned
  illustrations later by replacing files of the same id.
- E2E rule learned twice: never assert on a phase shorter than ~1.2 s (an auto-retrying assertion polls
  at 100/250/500/1000 ms) and never assert on a transient phase after a sleep or a screenshot; wait for
  the next phase's lasting marker instead.

## External blockers (cannot be done in the cloud sandbox)
Apple root certificates and App Store credentials, Google Play service account, real devices/TVs,
Docker image build, LLM API key for audit passes, SMTP credentials, production domain/TLS, signing
and `eas build` / `eas submit` for the iOS and Android apps.
