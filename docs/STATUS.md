# Status (update at the end of every milestone and before ending a session)

Branch: `claude/cloud-session-infrastructure-ln57mp` · Last updated: 2026-10-18

## Milestones
| Milestone | State | Notes |
|---|---|---|
| Planning (ADR-0001…0020, PLAN, ACCEPTANCE, AUDIT) | DONE | contradictions resolved, see ADRs |
| M0 Foundations | DONE | pnpm/turbo/TS strict/ESLint/Prettier/Vitest, CI, DB runner, test DB helper |
| M1a protocol + engine | DONE | pure reducer, scoring, director, views, final stage; unit + property tests |
| M1b database + realtime | DONE | HTTP + WS, sessions with token rotation, durable event log with fencing, crash recovery, rate limits, static web serving with strict CSP |
| M1c web TV + browser controller | DONE (CI green: check, integration, e2e) | `/tv` (QR lobby → game → results → rematch), `/join`, `/game`, settings (rounds, difficulty, categories), lobby tools for the leader, English + Turkish, synthesized sound, animated art; Playwright E2E with real Chromium |
| M2 Party mechanics & resilience | DONE (CI result of the latest push: see "Next actions") | reconnect, token rotation, leader migration, display grace, crash recovery, rate limits (M1b) plus a prep phase with stakes, Double Down, 50/50, sabotage (JAM / SHUFFLE / FOG / LOCKOUT / POINT_TAX) with shield, token earning, cooldowns and softened effects, CROWD reveal, POWER_RESOLUTION screen, persistence of power use (migration 0003), ATTACK 5 closed |
| M3 Content factory & admin | DONE (CI of the latest push: see "Next actions") | question schema + fingerprints + duplicate detection, importer/audit/export CLIs, 170+ TR dev seed, migration 0004, REPORT_QUESTION, bans, flags, maintenance job, email-OTP sign-in + staff roles, admin API (RBAC, CSRF, audit log), admin console SPA under `/admin`, acceptance Y/Z proven, AC partial (Blind Quiz reports are M5), red team ATTACK 15–24 |
| M4 Accounts & payments | DONE (store sandbox purchases are external) | purchase verification (Apple StoreKit 2 via Apple's verifier, Google Play via the Developer API), entitlements bound to one account, restore, refund notifications, TV unlock link (QR) with live tier change, `/unlock` and `/purchase` pages, account export/deletion; acceptance U partial, V–X pass; red team ATTACK 9 and 25 |
| M5 Blind Quiz & friends | WIP | M5-a..c Blind/Custom quiz done; M5-d Who Said It done (`SUBMIT_STATEMENT`, statement-per-question deck, author exempt, scrubbed at close, flag `mode.who_said_it`); M5-e AI decoy adapter (flag `ai.decoys`, off; HTTP provider with deadline + circuit breaker, strict output, fallback to the target's own alternatives); M5-f canary + ATTACK 10, which found and closed the creator-held-invite hole (claim cookie, migration 0007); Blind-Quiz reports remain |
| M6 Mobile | DONE in the sandbox (device/store parts are external) | `apps/mobile` Expo SDK 58 + expo-router, TypeScript strict: Home, Join (code / nickname / avatar, deep links `quiznight://join/CODE`, `https://host/j/CODE`), Lobby, Prep (Risk stake, Double Down, Sabotage), Question (50/50, SHUFFLE/FOG/JAM), Reveal/Score/Results, Reconnect banner, Purchase (`PurchaseProvider` over `expo-iap`, account-bound), Unlock link, Profile (email OTP as MOBILE session, export, delete). Shared `controller-client`/`i18n`/`ui-tokens`; Jest 132 tests; ws test drives the app runtime against the real server. See `docs/MOBILE.md` |
| M7 Polish, hardening, release | TODO | |

## Test inventory (all run locally and in CI)
| Layer | Command | Count |
|---|---|---|
| unit (packages, realtime, scripts) | `pnpm test` | 684 |
| web (jsdom: web app screens, unlock page, admin console client, sign-in, question editor) | `pnpm test:web` | 110 |
| integration (PostgreSQL) | `pnpm test:integration` | 261 |
| websocket (real server, real sockets, static serving of both apps, TV unlock, the phone app runtime) | `pnpm test:ws` | 95 |
| red team (ATTACK 1–34 map in `docs/RED_TEAM.md`) | `pnpm test:red-team` | 80 |
| mobile (Jest + Testing Library: logic, state→UI mapping, purchase flows) | `pnpm test:mobile` | 132 |
| browser E2E (real Chromium: TV + phones, reloads, drops, QR, remote keys, every power, report → console loop, TV unlock by phone) | `pnpm test:e2e` | 17 |

The local gate is `format → lint → typecheck → unit → web → integration → websocket → red-team`,
then `pnpm run build:web && pnpm run build:admin && pnpm test:e2e`.

## Recent balance change
ADR-0021 (power limits): Double Down is refused with HIGH / ALL_IN (`DOUBLE_DOWN_STAKE_CONFLICT`), gains
after stake and Double Down are capped at 3x (FINAL 5x) of base + speed, Double Down extra loss 100 → 200,
config version 2. Phone prep screens (web + mobile) disable the conflicting button with a hint.

## Next actions
1. Read the CI result of the latest push (`mcp__github__actions_list`) and fix anything red.
2. M5: Blind-Quiz reports (acceptance AC rest); a "suggest alternatives" button and a "link already used" message on the respond page (server route and 403 exist; web not wired); browser E2E for the respond page.
3. M6 follow-ups: everything in `docs/MOBILE.md` "Owner checklist" (accounts, ids, keys, EAS builds, device runs); then phone parity (categories, kick, report).
4. M7: polish, perf, release audit.

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
