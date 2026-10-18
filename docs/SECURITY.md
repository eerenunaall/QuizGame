# Security

The security design in one place, written from the code. The decisions are in ADR-0008 (protocol), ADR-0009
(sessions), ADR-0012 (accounts), ADR-0013 (payments), ADR-0015 (personal content) and ADR-0018 (posture); the
attack-to-test map is `docs/RED_TEAM.md`. A row here is a claim that a named file or test backs; the release audit
(`pnpm release:audit`) re-checks the mechanical ones.

## 1. Trust model

TV = stage, phone = controller, **server = game master**. Clients send intents only. The server decides time
(answer speed is measured from its own receive time; `clientSentAt` is diagnostic only), answers, score, legality
and what each client may see. Views are built with allow-lists and every outbound message is checked against a
`.strict()` schema in development and test (`VALIDATE_OUTBOUND`, on by default outside production for speed; the
payload scanner in `tests/helpers/scan.ts` runs over every frame of the websocket and red-team suites and fails on a
forbidden key such as an unrevealed answer).

## 2. Controls that exist

| Area | Control | Where / proof |
|---|---|---|
| Production boot | refuses to start without a unique `SERVER_SECRET` (32+ chars), without `DATABASE_URL`, with `QP_ALLOW_DEV_SEED=1`, with `RATE_LIMIT_SCALE` other than 1, with a non-https `PUBLIC_WEB_URL` or any non-https/empty `ALLOWED_ORIGINS` | `config.ts` `loadConfig`; `config.test.ts`; release audit |
| Dev content | the development question bank is refused by the CLI when `NODE_ENV=production` (unless `QP_ALLOW_DEV_SEED=1` is set explicitly, which the server itself refuses to boot with); the server will not boot with `QP_ALLOW_DEV_SEED=1` there | `scripts/question/cli.ts`, `config.ts`; release audit |
| Route policy | a route cannot be registered without `config.auth` and `config.limit`; admin routes must name roles; session/admin routes must have a limit | `app.ts` `onRoute` guard; inventory in `docs/FINAL_RELEASE_AUDIT.md` |
| Auth guard | `session` routes need a signed-in account, `admin` routes a staff session of kind ADMIN with one of the route's roles; checked before the body is read; every admin write is in `admin_audit` | `auth/guard.ts`, `admin/permissions.ts`, `admin/audit.ts` |
| CSRF | cookie-authenticated state changes need an allowed `Origin` and the CSRF header; refusals are recorded (`CSRF_REFUSED`) | `auth/guard.ts` |
| CORS / WebSocket origin | HTTP CORS only for `ALLOWED_ORIGINS`; browsers' WebSocket upgrades from other origins are refused (`WS_ORIGIN_REJECTED`); native apps send no Origin | `app.ts`, `ws/gateway.ts` |
| Transport | production headers include `Strict-Transport-Security: max-age=31536000; includeSubDomains`; session cookie is `HttpOnly; SameSite=Strict`, plus `Secure` in production. TLS itself is terminated by Caddy (`docs/DEPLOYMENT.md`) `[UNTESTED HERE]` | `app.ts`, `auth/guard.ts` |
| Headers | API: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, CSP `default-src 'none'; frame-ancestors 'none'`. Web app shell: CSP with `script-src 'self'` plus hashes of the few inline scripts (never `unsafe-inline`), `style-src 'self'`, `connect-src 'self'` + this host's `ws(s)` origin, `frame-ancestors 'none'`, `base-uri 'none'`; `Permissions-Policy` denies camera, microphone, geolocation, payment | `app.ts`, `http/static-web.ts`; ws `static.test.ts` |
| Static files | no dotfiles but the two app-link association files, no path traversal, a missing asset never turns into the HTML shell | `static-web.ts` `resolveSafe`; ws `static.test.ts` |
| Input | every HTTP body/query/params and websocket payload is parsed by strict zod schemas; bodies are capped at 16 kB, websocket messages at 16 kB; NUL bytes refused for every route; unknown message types are errors; malformed URLs get the standard error shape | `packages/protocol`, `http/hygiene.ts`, `app.ts` `bodyLimit`/`frameworkErrors` |
| Error handling | stack traces and internals never leave the server: 5xx answers `INTERNAL`, 4xx answers `INVALID_MESSAGE` | `app.ts` error handler |
| Rate limits | token buckets per class (room creation 10/hour/address, room lookup, join, reconnect, answers, powers, statements, reports, sign-in request/verify, purchases, webhooks, quiz editing, admin read/write/heavy). **In memory, one process** (no Redis implementation) | `security/rate-limit.ts` `LIMITS` |
| Connection caps | `MAX_WS_CONNECTIONS` (5000) and `MAX_WS_PER_IP` (40) | `ws/gateway.ts`, `config.ts` |
| Proxy trust | `X-Forwarded-For` is read only when `TRUST_PROXY_HOPS` > 0, taking the entry that many hops from the right | `ws/gateway.ts` `clientIp` |
| Pseudonyms | IPs/devices stored as keyed HMAC pseudonyms; tokens, one-time codes and invite links stored as keyed hashes | `security/crypto.ts` |
| Session tokens | 256-bit random, hashed at rest; room tokens rotate on reconnect with a 10 s grace for the previous token and reuse detection (ADR-0009); account sessions: web 30 days sliding, admin 1 h idle / 12 h absolute | `rooms/sessions.ts`, `auth/account-sessions.ts`; red-team ATTACK 8 |
| Sign-in codes | 6 digits, 10 minutes, keyed hashes, attempt limits, per-mailbox and per-address limits, uniform answers for known/unknown addresses | `auth/otp.ts`; red-team ATTACK 22 |
| Admin | roles ADMIN/EDITOR/MODERATOR/SUPPORT per route, short sessions, staff cannot self-delete, the last administrator cannot be removed | `admin/permissions.ts`, `auth/accounts.ts`; red-team `admin-access.test.ts` |
| Payments | receipts verified server-side (Apple StoreKit 2 signed data against Apple's roots you supply; Google Play Developer API); entitlements bound to one account; refunds revoke; webhook secret in the Google push URL; sandbox purchases accepted only while `PAYMENTS_ACCEPT_SANDBOX=1` | `payments/*`; integration `purchases`; red-team ATTACK 9, 25 |
| Personal content | answers sealed with AES-256-GCM, key id + AAD stored with the ciphertext; the creator's API has no read path; claim cookie after consent; traces erased when the room closes | `blind/*`; ATTACK 10; `blind-canary` |
| Feature switches | database flags, cached 15 s; a missing flag or an unreadable database means **off** | `flags/service.ts` |
| Dependencies | lockfile committed, exact versions in every `package.json`, `pnpm install --frozen-lockfile` in CI, Dependabot weekly | `.github/dependabot.yml`, `ci.yml`, release audit |
| Logging | pino redaction of authorization, cookies, `reconnectToken`, `token`; no personal answer in any log at trace level (canary test) | `app.ts`, `blind-canary.test.ts` |

## 3. Known gaps (honest list)

| Gap | Effect | Mitigation today |
|---|---|---|
| Retention jobs for room history, security events, telemetry, OTP rows and dead sessions are not scheduled | data older than the ADR-0018 periods stays | SQL in `docs/PRIVACY.md` section 5, run monthly |
| Rate limiter and room ownership are single-process; there is no Redis implementation | cannot run two app instances behind a balancer | deploy one instance (`docs/DEPLOYMENT.md`) |
| No IP allow-list for `/admin` (ADR-0018 says optional) | the admin console is reachable from the internet, protected by e-mail code, roles and short sessions | add a Caddy `remote_ip` rule `[UNTESTED HERE]` |
| One database role (the app uses the owner role of its database); no separate role for destructive jobs (ADR-0018 target) | a SQL-injection-class bug would have full rights; all queries are parameterised (Kysely) | none beyond that |
| `scripts/secret-scan` and `pnpm audit` in CI are not set up (ADR-0018 target) | | `pnpm release:audit` scans tracked files for key-shaped secrets and model identifiers; enable GitHub secret scanning in the repository settings (owner) |
| Flags `sabotage.noise`, `auth.apple`, `auth.google` exist in the database but no code reads them | flipping them changes nothing | do not rely on them as switches |
| E-mail sign-in is the only account login; the mail path depends entirely on your webhook service | no mail, no admin access | keep a second administrator; test the mail path (`docs/DEPLOYMENT.md` section 5) |
| Safari/Firefox/Edge/real TVs and real networks were not exercised | see `docs/BROWSER_MATRIX.md` | owner device pass |
| Blind-Quiz-specific reports (a moderator-only snapshot of a personal question) are not built | acceptance AC partial | personal questions are refused by the bank report path; moderate by closing rooms and banning |

## 4. Reporting a vulnerability

Publish a contact address (security@ your domain or a GitHub private advisory) and say so on the support page;
decide the response times you can honour. The repository has no `SECURITY.md` at the root that GitHub would
show; copy this section there once the contact exists (`docs/EXTERNAL_CHECKLIST.md`).

## 5. Checks to run before every release

`pnpm check`, `pnpm test:all`, `pnpm test:e2e`, `pnpm release:audit`, then the manual items in
`docs/RELEASE_CHECKLIST.md`. A bug found anywhere becomes a regression test first (CLAUDE.md hard rules).
