# ADR-0018: Security and privacy posture

Status: Accepted · Date: 2026-10-06

## Decision
### Principles
1. The client is hostile. The server decides validity, time, score, legality and visibility.
2. Secrets never reach a client before they are meant to; allow-list views, strict outbound schemas.
3. Every state-changing action is authenticated (session or account), authorized (role/phase),
   validated (zod), rate limited, idempotent and logged.
4. Fail closed: missing production secrets abort the boot; an unknown message type is an error.

### Controls
| Area | Control |
|---|---|
| Transport | HTTPS/WSS only in production (HSTS, `Secure` cookies); `ws://` allowed for localhost dev |
| Headers | CSP (`default-src 'self'`; script/style from self; `connect-src` api+wss; no inline script), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, Permissions-Policy |
| CORS/Origin | explicit allow-list from env; WebSocket `Origin` check (ADR-0008); no wildcard credentials |
| Rate limiting | token buckets keyed by IP, session, account and connection; HTTP route classes (auth, room-create, room-lookup, purchase, report); optional Redis backend; trust of `X-Forwarded-For` only with `TRUST_PROXY` hops configured |
| Abuse | room-create cap per IP/hour, room-code lookup throttling + generic errors, WebSocket flood ⇒ 1008 + back-off, nickname/statement profanity filter (obscenity + Turkish patterns), per-room report/kick, bans by account / device-hash / IP-hash with expiry |
| Auth tokens | 256-bit random, hashed at rest; rotation & reuse detection (ADR-0009); OTP as HMAC with attempt limits |
| Input | every HTTP body/query/params and WS payload parsed by zod `.strict()`; size caps; Unicode sanitization for user text |
| Logging | pino redaction of tokens, codes, answers, blind text, emails (hashed in logs); correlation ids; no stack traces to clients |
| Admin | server-side RBAC per route, audit log of every admin write (`admin_audit`), short session, optional IP allow-list |
| Secrets | env only, never committed; `scripts/secret-scan` + GitHub secret scanning in CI |
| Dependencies | lockfile committed, `pnpm audit` (non-blocking report) in CI, Dependabot config |
| DB | least-privilege app role; parameterised queries only (Kysely); append-only tables for events/audits; destructive jobs run as a separate role |

### Privacy
- Players are pseudonymous: nickname + random session id. Analytics use HMAC pseudonyms
  (rotating salt), allow-listed props only, never nicknames, answers, blind text or payment data.
- Retention: room sessions/events 30 days (aggregated stats kept), security events 180 days,
  statements 24 h after room close, blind data per ADR-0015, OTP rows 24 h.
- Data subject rights: account export (`GET /v1/me/export`) and deletion (`DELETE /v1/me`), documented
  in the privacy page; KVKK/GDPR checklist in `docs/PRIVACY.md` (to be reviewed by counsel — not legal advice).

### Threat-to-test map
Every GDD §19/§20/§37 threat and every brief ATTACK 1–14 maps to a named test in `tests/red-team`
(see `docs/RED_TEAM.md`); a bug found anywhere becomes a regression test first.

## Verification
`tests/red-team/*` run in CI; header test; log-redaction test; route-registry guard (auth policy
declared, rate-limit class declared, body schema declared).
