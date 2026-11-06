# Implementation audit — 2026-10-06 (baseline)

## Scope inspected
Repository root, all tracked files (`git ls-files`), history, branches, package manifests, lockfiles,
database schema, environment files, test setup, docs, UI, backend, mobile code, CI, deployment files.

## Existing functionality
None. The repository contains one commit with a one-line `README.md`. There is no package manifest,
lockfile, schema, env file, test, CI or deployment file; nothing exists to preserve or delete.

## Missing functionality
Everything in the GDD: monorepo, shared protocol, game engine, realtime server, database, web display,
browser and native controllers, payments/entitlements, question bank and audit pipeline, admin, Blind
Quiz, analytics, tests, CI, deployment, monitoring, backups.

## Broken functionality
n/a (nothing to break).

## Specification risks found while planning (all resolved in ADRs)
| # | Finding | Resolution |
|---|---|---|
| 1 | `docs/GDD.md` referenced but absent | imported verbatim (ADR-0001) |
| 2 | Scoring composition, penalties, caps undefined; 50/50 "2× reward" contradicts its own rationale | ADR-0007 |
| 3 | Blind Quiz: previewing generated options leaks the answer; reveal vs "creator never sees"; AI vs "no invented facts"; moderation vs privacy | ADR-0015 |
| 4 | TV ↔ account link without reusable QR secrets | link intents, ADR-0013 |
| 5 | "Recover after restart" without a timer policy | time-freeze recovery, ADR-0006 |
| 6 | Next.js vs old Smart-TV engines | Vite + legacy bundle + capability gate, ADR-0004 |
| 7 | Login method, Apple 4.8, account deletion | ADR-0012 |
| 8 | Turkish-first product with English example strings | i18n, ADR-0016 |
| 9 | Sabotage *Noise* conflicts with "no result manipulation"; counterplay/accessibility undefined | ADR-0010 |
| 10 | `ENTITLEMENT_GRANTED` vs `ENTITLEMENT_CHANGED` | ADR-0008 |
| 11 | "Host" undefined for phone-only leaders; migration rules vague | ADR-0009 |
| 12 | QUESTION vs ANSWERING, FINAL, REMATCH, late join, display loss undefined | ADR-0005 |
| 13 | Reconnect-token theft handling unspecified | rotation + reuse detection, ADR-0009 |
| 14 | "Semantic embedding similarity" with no provider; no LLM key in sandbox | provider interface + honest fallback, ADR-0014 |

## Architectural risks
- Single owner process per room: scale-out requires edge routing (mitigated by lease + fencing, ADR-0003).
- TV browsers are only partially testable (current Chromium only): console/Smart-TV support stays
  unclaimed until physically verified (ADR-0004, ADR-0019).
- Content volume (50k) depends on external LLM budget and human sampling.

## Security risks (to be closed by tests, see `docs/RED_TEAM.md`)
Answer/score/timer tampering, replay, forged host commands, room-code enumeration, token theft,
purchase forgery and cross-account replay, blind-answer leakage, deep-link injection, UGC abuse,
WebSocket floods.

## Test gaps
All layers are unbuilt (ADR-0019 defines them).

## Environment audit
Node 22.22, pnpm 10.28, PostgreSQL 16 (startable), Redis 7, Chromium 141-class (Playwright revision
1194), Java present. **Not available:** Docker daemon, Xcode/Android SDK, Firefox/WebKit, Apple
hosts (apple.com / appleid.apple.com unreachable), real devices. LLM and SMTP credentials absent.
Reachable: npm registry, Google JWKS, api.anthropic.com host (no key).

## Proposed sequence
See `docs/PLAN.md` (M0 → M7).
