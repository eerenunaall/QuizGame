# Status (update at the end of every milestone and before ending a session)

Branch: `claude/cloud-session-infrastructure-ln57mp` · Last updated: 2026-10-19

## Milestones
| Milestone | State | Notes |
|---|---|---|
| Planning (ADR-0001…0020, PLAN, ACCEPTANCE, AUDIT) | DONE | contradictions resolved, see ADRs |
| M0 Foundations | DONE | pnpm/turbo/TS strict/ESLint/Prettier/Vitest, CI, DB runner, test DB helper |
| M1a protocol + engine | DONE | pure reducer, scoring, director, views, final stage; unit + property tests |
| M1b database + realtime | DONE | HTTP + WS, sessions with token rotation, durable event log with fencing, crash recovery, rate limits, static web serving with strict CSP |
| M1c web TV + browser controller | DONE (CI green: check, integration, e2e) | `/tv` (QR lobby → game → results → rematch), `/join`, `/game`, settings (rounds, difficulty, categories), lobby tools for the leader, English + Turkish, synthesized sound, animated art; Playwright E2E with real Chromium |
| M2 Party mechanics & resilience | DONE (CI result of the latest push: see "Next actions") | reconnect, token rotation, leader migration, display grace, crash recovery, rate limits (M1b) plus a prep phase with stakes, Double Down, 50/50, sabotage (JAM / SHUFFLE / FOG / LOCKOUT / POINT_TAX) with shield, token earning, cooldowns and softened effects, CROWD reveal, POWER_RESOLUTION screen, persistence of power use (migration 0003), ATTACK 5 closed |
| M3 Content factory & admin | DONE (CI of the latest push: see "Next actions") | question schema + fingerprints + duplicate detection, importer/audit/export CLIs, 170+ TR dev seed, migration 0004, REPORT_QUESTION, bans, flags, maintenance job, email-OTP sign-in + staff roles, admin API (RBAC, CSRF, audit log), admin console SPA under `/admin`, acceptance Y/Z proven, AC (personal-quiz reports added in M7), red team ATTACK 15–24 |
| M4 Accounts & payments | DONE (store sandbox purchases are external) | purchase verification (Apple StoreKit 2 via Apple's verifier, Google Play via the Developer API), entitlements bound to one account, restore, refund notifications, TV unlock link (QR) with live tier change, `/unlock` and `/purchase` pages, account export/deletion; acceptance U partial, V–X pass; red team ATTACK 9 and 25 |
| M5 Blind Quiz & friends | WIP | M5-a..c Blind/Custom quiz done; M5-d Who Said It done (`SUBMIT_STATEMENT`, statement-per-question deck, author exempt, scrubbed at close, flag `mode.who_said_it`); M5-e AI decoy adapter (flag `ai.decoys`, off; HTTP provider with deadline + circuit breaker, strict output, fallback to the target's own alternatives); M5-f canary + ATTACK 10, which found and closed the creator-held-invite hole (claim cookie, migration 0007); Blind/Custom Quiz reports done (migration 0010, see below) |
| M6 Mobile | DONE in the sandbox (device/store parts are external) | `apps/mobile` Expo SDK 58 + expo-router, TypeScript strict: Home, Join (code / nickname / avatar, deep links `quiznight://join/CODE`, `https://host/j/CODE`), Lobby, Prep (Risk stake, Double Down, Sabotage), Question (50/50, SHUFFLE/FOG/JAM), Reveal/Score/Results, Reconnect banner, Purchase (`PurchaseProvider` over `expo-iap`, account-bound), Unlock link, Profile (email OTP as MOBILE session, export, delete). Shared `controller-client`/`i18n`/`ui-tokens`; Jest 132 tests; ws test drives the app runtime against the real server. See `docs/MOBILE.md` |
| M7 Polish, hardening, release | TODO | |

## Red-team / QA round of 2026-10-26
Five independent passes (engine, realtime security, venue mode, player web UI, production deploy/admin/bank), every fix with a
regression test written first. Engine: pick-phase progress counts only online players and ends as soon as the last awaited player
leaves; the venue meter is re-read at the round boundary (no free round after time-up); the total-multiplier ceiling also holds a
stake alone. Server: ATTACK 38 (one socket, one seat), 39 (Latin look-alike letters), 40 (lobby-state write budget); `/metrics`
token compared in constant time. Venue: pushes of one table are ordered and re-read, switching `venue.sessions` off lets running
tables go, the report's default range follows the venue's calendar. Web: phone countdown survives a screen lock, one answer per
question, failed sends re-enable the options, four answers fit 320x568, TV titles clear the top bar. Deploy: SIGTERM reaches node,
the bank loader no longer re-activates questions a moderator pulled, origins are normalised and a mismatch refuses to boot,
malformed admin imports answer 422. Open design notes: reward expiry at venue midnight, one person with several phones,
server downtime is billed to the table, OTP lockout by a stranger (ADR-0012 trade-off).

## Show pass: sound and motion (docs/AUDIO.md)
Original, generated sound palette (one key, one timbre family, shared limiter and room, TV and phone ceilings,
lobby ambience, staged reveal / podium scores, a hit cue per sabotage kind; no audio files, nothing to license)
and a choreographed motion layer (staged reveal with drum roll, streak flames + combo toasts, last-seconds
urgency with phone vibration, score bars with overtake glow, staged podium, hit impact, phase sweep, avatar
arrival). `pnpm audio:render` renders and measures the palette offline in Chromium. Found on the way: CSS
modules renamed every shared `qp-*` keyframe reference to a hashed name, so no shared animation ever ran;
fixed in `apps/web/css-scope.ts` with a guard test. Tests: `lib/sound/sound.test.ts`, `lib/audio.test.ts`,
`ui/anim/anim.test.tsx`, `lib/css-scope.test.ts`, e2e `show.spec.ts`. Not done: a listening pass on a real TV in
a loud room (the palette is measured, not heard), real-device haptics.

## Teams, simple ruleset, sound and motion (2026-10-27)
Teams and the café ruleset: ADR-0026 (players score individually, teams ranked by average per active member, one reward code to the
winning team's best connected member, simple set = 50/50 + Double Down + Time Cut/Shuffle/Blind Clock, 30 s window, question text TV-only
while the options stay on the phone). Leader or venue default chooses individual/team and ruleset; staff edit team names and the window.
Sound palette (synthesised, `docs/AUDIO.md`, `pnpm audio:render`), staged reveal, streak flames, urgency vignette, podium; the shared
`qp-*` keyframes now actually run (CSS-module scoping bug fixed). Lobby lists categories with at least `CATEGORY_MIN_QUESTIONS` (15 in
production); rewards stay valid at least four hours. Not done: native mobile UI for teams (the store app is not shipped).

## Studio site (`sites/archonbite/`)
Static, build-free, bilingual site for archonbite.com: Steam-style store pages for QuizNight and Salty Pirate (the latter is a
placeholder driven by `data/games.json`, see `OWNER-FILL.md`), `/play/` (links to `PLAY_URL`, never an iframe), `/guide/`, legal
draft. Deploy steps in `DEPLOY.md`; `node sites/archonbite/tools/check.mjs` validates links, metadata and i18n parity.

## Venue question sets (ADR-0025, same flag `venue.sessions`)
A café's owner uploads CSV/JSONL questions from `/staff` → Sorular (owner only; staff see counts): dry-run with per-row
Turkish fix messages, then import; passing rows are ACTIVE at once (heuristic audit PASS, owner-attested, no fact check),
REVIEW/REJECT/invalid/duplicate rows are listed and never stored. Migration 0011 (`questions.owner_venue_id`, pool `VENUE`,
venue categories, uploads journal, append-only content events, `venue_question_history`, guard amendment). Served only in
rooms with an open table of that venue (`question source` MIXED 30 % / VENUE_ONLY / GLOBAL_ONLY); freshness ranking over the
venue's last 300 played per category (`VENUE_FRESH_WINDOW`) for venue and global questions. Limits 2000 rows / 2 MB per file,
5000 questions and 20 categories per venue, per-account and per-venue rate limits, idempotent by file hash. Owner reports
list + retire; admin console lists/retire sets. Guide `docs/VENUE.md`, template/prompt `docs/venue-question-template.md`.
Tests: schema `venue-file`/`venue-template`, `freshness` (property), i18n coverage `venue/messages`; integration
`venue-questions`, `venue-deck`; ws `venue-questions`; red-team ATTACK 37; web `venue-questions.test.tsx`; e2e `venue-questions.spec.ts`.
Known limits: venue categories are not in the public lobby picker (played under "all categories"); `retire-dev` style bank
switches must skip `owner_venue_id IS NOT NULL` rows.

## Test inventory (all run locally and in CI)
| Layer | Command | Count |
|---|---|---|
| unit (packages, realtime, scripts) | `pnpm test` | 888 |
| web (jsdom: web app screens, unlock page, admin console client, sign-in, question editor) | `pnpm test:web` | 190 |
| integration (PostgreSQL) | `pnpm test:integration` | 263 |
| websocket (real server, real sockets, static serving of both apps, TV unlock, the phone app runtime) | `pnpm test:ws` | 102 |
| red team (ATTACK 1–35 map in `docs/RED_TEAM.md`) | `pnpm test:red-team` | 114 |
| mobile (Jest + Testing Library: logic, state→UI mapping, purchase flows) | `pnpm test:mobile` | 147 |
| browser E2E (real Chromium: TV + phones, reloads, drops, QR, remote keys, every power, report → console loop, TV unlock by phone, phone controller measurements) | `pnpm test:e2e` | 37 |

The local gate is `format → lint → typecheck → unit → web → integration → websocket → red-team`,
then `pnpm run build:web && pnpm run build:admin && pnpm test:e2e`.

## Venue mode (ADR-0024, flag `venue.sessions`, off by default)
"Version 1 - Venue mode" for board-game cafés (first customer Gusto Board Game Cafe); owner/staff guide in Turkish:
`docs/VENUE.md`. The system meters time and never handles money. Migration 0009 (venues, venue_staff, venue_sessions,
append-only venue_session_events, venue_rewards with hashed codes). Engine: pure meter (`venue.ts`, injected clock),
`VENUE_METER` input; `START_GAME`/`REMATCH` refused with `VENUE_TIME_UP` / `VENUE_PAUSED`; a round in progress always
finishes, then results (`cutShort`); the room is FULL through the existing `ENTITLEMENT` input while time runs and back to
FREE at time-up/end unless a guest account is linked. Server: `apps/realtime/src/venue` (service with one timer per running
table, restored after a restart; staff routes with per-venue membership; rewards: single winner, ties get nothing, min
players, daily cap in the venue's time zone, rematch cool-down, code only to the winner's phone, redeem by one conditional
UPDATE). Web: `/staff` desk (Masalar, Yeni masa by room code or the TV's unlock QR, Ödül doğrula, owner Ayarlar + staff by
email), TV chip next to the room code (amber ≤ 5 min, red ≤ 1 min), "Süre doldu" screen, reward banner, winner's code card.
Admin console: Mekanlar (create, owner, per-day report + CSV). Tests: engine `venue`, `reducer.venue`; realtime
`venue/settings`; integration, ws, red-team ATTACK 36 and e2e `venue.*`; web `venue.test.tsx`; admin `Venues.test.tsx`.
Not built: moving a table to another TV, multi-instance rooms (single instance like entitlements), a camera QR reader inside
`/staff` (staff use the phone camera on the TV's unlock QR), the native app's chip/time-up screen (it ignores the fields).
Not verified: a real café evening, real TVs, the gusto theme's logo on the time-up screen at distance.

## Risk time and Sabotage time (ADR-0022)
`QUESTION_PREP` is retired. Each round now runs `RISK_PICK` (stake + Double Down) then `SABOTAGE_PICK`
(sabotage or pass), each with its own timer (`riskPickMs` 12 s, `riskPickDecisionMs` 16 s for RISK/FINAL
rounds, `sabotagePickMs` 12 s, all optional in the config), a dedicated TV screen (loud title, big ring, one-line
rule, tick count only) and dedicated phone screens (`RiskScreen`, `SabotageScreen` with a calm wait screen for
players who cannot act). Intents are `COMMIT_RISK` / `COMMIT_SABOTAGE`, legal only in their own phase
(`INVALID_STATE` otherwise); a phase nobody can act in is skipped and early advance waits only for players who
can act. `apps/mobile` renders both phases (`PickViews`) and, since ADR-0023, the new risks and sabotages.
Old data: `QUESTION_PREP` stays in the enum and is treated as `RISK_PICK`. Tests: `reducer.picks.test.ts`, ws/red-team
`powers`, e2e `picks.spec.ts`.

## New risks and sabotages (ADR-0023)
The research shortlist is built and each item has its own config switch (`powers.<name>.enabled`, default on, all
optional so old snapshots parse; config version 3): **Cover (Örtü)**, an opt-in **Duel (Düello)** (the rival accepts or
declines in the same RISK_PICK via `RESPOND_DUEL`) and **Pot (Havuz)** in RISK_PICK, **Stake Cap (Bahis Sınırı)**, **Cut
(Kesme)** (never the leader, never a player with no points) and **Blind Clock (Kör Saat)** in SABOTAGE_PICK. One big
gamble per question now covers HIGH, ALL_IN, Double Down and Duel (interaction table in ADR-0023, enforced in
`checkRisk` and asserted by a test over all 48 combinations). Pot, Duel and Cut only move points (property-tested to
sum to zero); Cover costs a fee. TV: POWER_RESOLUTION shows Cover, Pot, Duel and paid Cuts; RISK TIME lists the extras;
SABOTAGE TIME lists the menu. Phones (web and native): cards in the existing power-card style, disabled with a one-line
reason, the Duel invite on the rival's phone, Cut greyed on the leader, a Blind Clock tile instead of the countdown. New
original inline-SVG icons (web) and emoji (native). Migration 0008. Tests: engine `scoring.risks`, `risks`,
`reducer.risks`, `reducer.sabotage-new`, `reducer.risks.property`; web `RiskExtras`, `SabotageNew`, `power`; mobile
`PickViews.risks`; ws `risks`; red-team ATTACK 35 (`risks.test.ts`); e2e `risks.spec.ts`. Not built from the research:
the second wave (Two-Step, Trim, Steam, Mirror, Spotlight, Backer, Herd, Rush). Not verified: balance in real play and
the native app on a device.

## Release-audit gaps closed for the browser-only product (2026-10-19)
The owner decided: browser only, no App Store / Play Store; `apps/mobile` stays as it is and is not extended. The four
OPEN rows of `docs/FINAL_RELEASE_AUDIT.md` are closed:
- **Retention**: `RetentionJob` (`apps/realtime/src/moderation/retention.ts`) on the maintenance timer deletes sign-in codes
  (24 h), dead sessions (7 days), security events and telemetry (180 days) and closed rooms with their game records (30 days),
  each an env override (`RETENTION_*`, also in the production compose file). It cannot reach purchases, entitlements, store
  notifications, the admin audit or the venue ledger. Integration `retention.test.ts` (injected clock, both sides of each limit).
- **Legal pages**: `/privacy` (KVKK aydınlatma style), `/terms` (free game, possible paid features later, trademark notice),
  `/support`, Turkish first then English, texts in `packages/i18n/src/legal.ts`, lazy-loaded, strict CSP unchanged; linked from
  the TV title, the phone code and join screens and the admin sidebar. Drafts: 39 `OWNER-TO-FILL` markers and a visible
  "not legal advice" notice; the audit lists them as EXTERNAL until the owner fills them and counsel reviews.
- **Export**: `GET /v1/me/export` includes `personalQuizzes` (what the creator's own API shows), never a target's answer.
- **Blind/Custom Quiz reports (acceptance AC)**: `REPORT_QUESTION` on a personal question stores quiz id + question id +
  reason (`personal_reports`, migration 0010); ADMIN/MODERATOR see ids only in the console (Reports page) and can remove the
  question, delete the quiz or dismiss, audited. No snapshot: nothing sealed leaves the vault. Who Said It stays unreportable.
Still open for a browser-only launch: a web button for account export/deletion (API and the RUNBOOK path exist), the owner's
legal identity and counsel review, and the store-related EXTERNAL rows (E, U, purchase verification) are moot while there are
no store builds.

## Recent balance change
ADR-0021 (power limits): Double Down is refused with HIGH / ALL_IN (`DOUBLE_DOWN_STAKE_CONFLICT`), gains
after stake and Double Down are capped at 3x (FINAL 5x) of base + speed, Double Down extra loss 100 → 200,
config version 2. Phone prep screens (web + mobile) disable the conflicting button with a hint.

## Phone controller after the first owner play-test (web only)
TV = stage, phone = controller: while a question runs (`QUESTION`, `ANSWERING`) the browser phone no longer
shows the question text. It shows the four answers (colour, letter and a shape: triangle, diamond,
circle, square), a TV icon with "Soruya TV'den bak" and a small "Soruyu göster" switch that reveals the text
in place; the choice is kept per device in `qp.prefs` (`phoneShowsQuestion`). Build default
`VITE_PHONE_SHOWS_QUESTION=1` turns it on for everybody (Dockerfile build arg too); the reveal is unchanged.
A locked answer stays on screen as a framed card with a lock, the clock is a fat bar at the top.
Sabotage is chip (token count) → two-column faces → the five real types as cards → one "Sabotajı gönder"
button. Since ADR-0022 it lives on its own SABOTAGE_PICK screen: "send" is the final `COMMIT_SABOTAGE`, it goes out
after a 2 s undo window (immediately when under ~3 s are left), and "Sabotaj yapmayacağım" confirms a pass. A player who cannot sabotage
(no token, cooldown, nobody to hit; the server says so in `you.sabotage.ready`) gets a calm waiting screen. `apps/mobile` still shows the question text (parity pending).

## Next actions
1. Read the CI result of the latest push (`mcp__github__actions_list`) and fix anything red.
2. M5: a "suggest alternatives" button and a "link already used" message on the respond page (server route and 403 exist; web not wired); browser E2E for the respond page.
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
