# Status (update at the end of every milestone and before ending a session)

Branch: `claude/cloud-session-infrastructure-ln57mp` · Last updated: 2026-10-06

## Milestones
| Milestone | State | Notes |
|---|---|---|
| Planning (ADR-0001…0020, PLAN, ACCEPTANCE, AUDIT) | DONE | contradictions resolved, see ADRs |
| M0 Foundations | DONE | pnpm/turbo/TS strict/ESLint/Prettier/Vitest, CI, DB runner, test DB helper |
| M1a protocol + engine | DONE | pure reducer, scoring, director, views, final stage; unit + property tests |
| M1b database + realtime | DONE | HTTP + WS, sessions with token rotation, durable event log with fencing, crash recovery, rate limits, static web serving with strict CSP |
| M1c web TV + browser controller | DONE (CI pending for the latest push) | `/tv` (QR lobby → game → results → rematch), `/join`, `/game`, settings (rounds, difficulty, categories), lobby tools for the leader, English + Turkish, synthesized sound, animated art; Playwright E2E with real Chromium |
| M2 Party mechanics & resilience | PARTIAL | resilience half is in (reconnect, token rotation, leader migration, display grace, crash recovery, idle/lifetime closing, rate limits). **Left:** 50/50, Risk stakes, Double Down, Sabotage + Shield, round-kind mechanics, display pairing |
| M3 Content factory & admin | TODO | |
| M4 Accounts & payments | TODO | |
| M5 Blind Quiz & friends | TODO | |
| M6 Mobile | TODO | |
| M7 Polish, hardening, release | TODO | |

## Test inventory (all run locally and in CI)
| Layer | Command | Count |
|---|---|---|
| unit (packages, realtime, scripts) | `pnpm test` | 265 |
| web (jsdom: router, storage, device, remote navigation, i18n coverage, screens) | `pnpm test:web` | 50 |
| integration (PostgreSQL) | `pnpm test:integration` | 18 |
| websocket (real server, real sockets) | `pnpm test:ws` | 53 |
| red team (ATTACK 1–14 map in `docs/RED_TEAM.md`) | `pnpm test:red-team` | 22 (+3 todo for M2/M4/M5 attacks) |
| browser E2E (real Chromium: 1 TV + 3 phones, reloads, drops, QR decode, remote keys) | `pnpm test:e2e` | 10 |

## Next actions
1. Read the CI result of the latest push (`mcp__github__actions_list`) and fix anything red.
2. M2: engine commands and views for Risk stakes, Double Down, 50/50, Sabotage + Shield, round-kind
   behaviour (ADR-0007/0010/0011), phone UI for them, TV power-resolution screen, tests incl. ATTACK 5.
3. M3: question schema, importer, audit pipeline, ≥ 170 TR seed questions, admin API + SPA.

## Known issues / decisions pending
- Polyfill chunk is 44 kB gzip; narrowing the browser target would shrink it (decide after a TV
  matrix run, M7).
- The static web server runs inside the realtime process (fine for one instance; put a CDN in front
  for production, see ADR-0003).
- Art is Fluent Emoji / Noto Emoji (permissive licences, credits page included). Swap for commissioned
  illustrations later by replacing files of the same id.

## External blockers (cannot be done in the cloud sandbox)
Apple root certificates and App Store credentials, Google Play service account, real devices/TVs,
Docker image build, LLM API key for audit passes, SMTP credentials, production domain/TLS, signing
and `eas build` / `eas submit` for the iOS and Android apps.
