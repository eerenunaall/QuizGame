# Deployment guide (one VPS, one domain)

Written for the owner, not for a programmer: copy the commands as they are. Everything here was derived
from the code (`apps/realtime/src/config.ts`, `infra/deployment/*`). **What the build sandbox could not
test is marked `[UNTESTED HERE]`**: the sandbox has no Docker, no public domain and no certificates, so
the first start on your server is the first real test of those parts. Keep `docs/RUNBOOK.md` open the first
time.

## 0. What you are building

```
phones / TV browsers --https--> Caddy (ports 80+443, gets the certificate by itself)
                                   |  private network
                                   v
                              game server (Node, port 8080, TV + phone + admin web pages inside)
                                   |
                                   v
                              PostgreSQL 16 (private, data in a Docker volume)
```

- One server runs everything (`docker-compose.prod.yml`). **One game-server instance only**: rooms live in that
  process's memory and the rate limiter is in memory too (there is no Redis implementation in this version, see
  `docs/ARCHITECTURE.md`). A restart is safe: running games are rebuilt from the database (ADR-0006).
- Sizing: a 2 vCPU / 4 GB VPS is far above what `docs/PERF.md` measured (20 rooms x 8 phones used about 0.4 of one
  core and 200 MB of RAM on a laptop-class VM). Those numbers are from loopback, not from the internet.

## 1. What you need first

1. A VPS with a public IPv4 address, Ubuntu 22.04 or 24.04, 2 GB RAM or more. Open ports 80 and 443 in the
   provider's firewall (not 5432, not 8080).
2. A domain you control, e.g. `quiz.example.com`. Create an **A record** for it pointing at the VPS address. Wait
   until `ping quiz.example.com` shows that address (minutes to hours).
3. Docker with the compose plugin on the VPS: follow <https://docs.docker.com/engine/install/ubuntu/> (`[UNTESTED HERE]`).
4. A way to send e-mail (section 5). Without it nobody, including you, can sign in to the admin console.
5. Your own e-mail address for the first administrator.

## 2. Get the code onto the server

```
git clone <your repository address> quizparty
cd quizparty/infra/deployment
```

## 3. Create the settings file

```
cp env.production.example .env
nano .env        # fill in every line, save with Ctrl+O, Enter, Ctrl+X
```

Make the secrets with these commands and paste the output into `.env`:

| Setting | How to get it |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `SERVER_SECRET` | `openssl rand -hex 32` (the server refuses anything shorter than 32 characters) |
| `METRICS_TOKEN` | `openssl rand -hex 24` (16 characters minimum) |
| `BLIND_DATA_KEYS` | `echo "k1:$(openssl rand -base64 32)"` (see `docs/BACKUP.md` before using Blind Quiz) |
| `DOMAIN` | your domain without `https://` |
| `ADMIN_BOOTSTRAP_EMAILS` | your address, lower case; several separated by commas |

`.env` holds every secret. Do not commit it (`.gitignore` already excludes `.env`), do not paste it into chats,
and keep an offline copy (password manager). **If you lose `SERVER_SECRET` or `BLIND_DATA_KEYS` they cannot be
recovered.**

## 4. Start it

```
docker compose -f docker-compose.prod.yml up -d --build      # first build takes several minutes
docker compose -f docker-compose.prod.yml ps                  # db, app, caddy should be "running"/"healthy"
docker compose -f docker-compose.prod.yml logs -f app         # Ctrl+C to leave
```

On start the app container applies the database migrations itself (`infra/deployment/entrypoint.sh`: it runs
`@quizparty/db migrate` before the server). Then open `https://<your domain>/healthz` in a browser: it shows
`{"ok":true}`. `https://<your domain>/readyz` also checks the database and that all migrations are applied.

If the app container keeps restarting, read `logs app`. The server **refuses to start** on unsafe production
settings and names the problem, for example `SERVER_SECRET must be set to a unique 32+ character secret`,
`PUBLIC_WEB_URL must be https`, `ALLOWED_ORIGINS must be https origins`, `QP_ALLOW_DEV_SEED must be 0 in
production`, `RATE_LIMIT_SCALE must be 1 in production` (`loadConfig`, verified by `config.test.ts`).

## 5. E-mail for sign-in codes (the one part that needs a service)

Two transports exist; set exactly one (the server refuses both). In production **with neither**, e-mail sign-in is
switched off (fail closed): nobody could log in to `/admin` or `/staff`. Outside production the code is printed in the
log (`ConsoleEmailSender`) - never in production, and the Render/compose production settings never enable that.

**A. Transactional-mail API (recommended): `HttpEmailSender`** (`apps/realtime/src/auth/http-email.ts`)

| Variable | Value |
|---|---|
| `EMAIL_PROVIDER` | `resend` or `brevo` |
| `EMAIL_API_KEY` | the API key from the provider (min. 8 characters; never logged) |
| `EMAIL_FROM` | `Gusto QuizNight <giris@your-domain>`; the address must be on a domain verified at the provider |

All three must be set together. One HTTPS call per mail, 8 s timeout, up to 3 attempts with 0.4 s / 0.8 s backoff on
network errors, timeouts, 408/425/429 and 5xx (never on 401/403/422: a wrong key or sender is not fixed by retrying),
a circuit breaker (5 failed mails in a row stop calls for 60 s, so an outage cannot pile up connections), redirects
refused so the key never travels to another host. The mail text is the Turkish or English sign-in text from
`packages/i18n` (the language the person's browser asked with). Failures are logged as `resend answered 422
(validation_error)`: provider, status and the provider's short label only - never the code, the address, the key or
the provider's message. The answer to the person asking for a code is always the same `202`, whatever the provider
does (an outage must not reveal which addresses have accounts).

*Why Resend is the default:* one endpoint (`POST https://api.resend.com/emails`), one `Authorization: Bearer` header,
a flat JSON body, clean error labels and an `Idempotency-Key` (a retry after a lost answer cannot send two codes);
the free plan (100 mails/day, 3 000/month at the time of writing, verify on the pricing page) is far above what a
café's staff sign-ins need; and it is reachable from Turkey. *Its catch:* it only sends from a domain you own and have
verified (below). *Brevo* (`POST https://api.brevo.com/v3/smtp/email`, header `api-key`) has a larger free plan (300
mails/day) and can send from one verified single address without owning a domain, but a free-mail sender such as
`@gmail.com` will often land in spam (DMARC), and new Brevo accounts may restrict API calls by IP address
(Security > Authorized IPs): Render's outgoing addresses change, so deactivate that restriction. Mailgun, Postmark and
MailerSend were not chosen: no permanent free tier or a longer review before the first mail.
**Neither provider was exercised from the build sandbox; the wire formats are tested against local doubles written
from the providers' documentation `[UNTESTED HERE]`.** Send yourself one real code before opening the venue.

**Sender domain (SPF / DKIM / DMARC), once, at the provider and your DNS host.** Use a subdomain of a domain you own,
e.g. `mail.your-domain.com`. At the provider: Domains > Add domain; it shows 2-3 DNS records. At your DNS host add them
exactly: an **SPF** record (TXT, `v=spf1 include:... ~all`, or the MX/TXT pair the provider shows for its bounce
subdomain), a **DKIM** record (TXT or CNAME with a long key, name like `resend._domainkey`) and optionally **DMARC** (TXT
`_dmarc` = `v=DMARC1; p=none; rua=mailto:you@your-domain.com`, tighten to `quarantine` after a week). Wait for the
provider to show "Verified" (minutes to a day). Until then mail is rejected (`422`) or lands in spam. If you own no
domain, buy a cheap one (a `.com` or `.com.tr` at any registrar) or use Brevo with a single verified sender address.
Do **not** use the provider's test sender (`onboarding@resend.dev`): it only delivers to your own sign-up address.

**B. Generic webhook** (unchanged): `EMAIL_WEBHOOK_URL` receives `POST` JSON `{"to","subject","text"}` with
`Authorization: Bearer <EMAIL_WEBHOOK_TOKEN>`; a non-2xx answer counts as a failure (`WebhookEmailSender`). Use it
with Make/Zapier/n8n or an adapter of your own.

## 6. Load the questions

A fresh production database has **no questions**, so no game can start. The hand-written development bank is
refused in production on purpose. Load a reviewed bank (see `docs/QUESTION_QUALITY.md`; the importer validates,
de-duplicates and audits):

```
docker compose -f docker-compose.prod.yml cp mybank.jsonl app:/tmp/mybank.jsonl
docker compose -f docker-compose.prod.yml exec app pnpm --filter @quizparty/scripts run question categories
docker compose -f docker-compose.prod.yml exec app pnpm --filter @quizparty/scripts run question import /tmp/mybank.jsonl --dry-run
docker compose -f docker-compose.prod.yml exec app pnpm --filter @quizparty/scripts run question import /tmp/mybank.jsonl
```

Questions then move through review in the admin console (`docs/ADMIN.md`); only active questions are played.
The importer can also be driven from the console. (Commands: `scripts/question/cli.ts`; `--dry-run` writes nothing.)

## 7. First administrator

1. `ADMIN_BOOTSTRAP_EMAILS` must contain your address (section 3). The first administrator exists only through this list (no one can promote themselves); later, an existing `ADMIN` can grant roles under Users.
2. Open `https://<your domain>/admin/`, enter your address, then the 6-digit code from the e-mail
   (codes last 10 minutes). The first successful sign-in with a listed address creates the `ADMIN` role
   (`AccountService.signIn`). Admin sessions end after 1 hour idle or 12 hours in all.
3. In the console, add colleagues under Users with the narrowest role that fits (`ADMIN`, `EDITOR`, `MODERATOR`,
   `SUPPORT`). The system will not let the last administrator be removed.
4. After the first sign-in you may remove your address from `ADMIN_BOOTSTRAP_EMAILS` (the role stays); leaving it is
   harmless because only listed addresses that prove mailbox ownership get the role.

## 8. Environment variables

Set in `docker-compose.prod.yml` (not by you) unless the column says "you". Source: `config.ts`.

| Variable | Production value / default | Notes |
|---|---|---|
| `NODE_ENV` | `production` | turns on the fail-closed checks, `Secure` cookies, HSTS, FREE room tier by default |
| `DATABASE_URL` | built from `POSTGRES_PASSWORD` | required |
| `PUBLIC_WEB_URL` | `https://<DOMAIN>` | must be https; goes into QR codes and links |
| `ALLOWED_ORIGINS` | `https://<DOMAIN>` | must be https; browsers from other origins are refused (HTTP CORS and WebSocket) |
| `SERVER_SECRET` (you) | 32+ chars | keys all stored hashes; **do not change casually** (RUNBOOK) |
| `METRICS_TOKEN` (you) | 16+ chars | `/metrics` answers 401 without `Authorization: Bearer <token>` and is off when unset |
| `ADMIN_BOOTSTRAP_EMAILS` (you) | list | section 7 |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` (you) | see section 5 | all three or none; not together with the webhook; `EMAIL_API_BASE` exists for tests and production refuses it |
| `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN` (you) | see section 5 | token at least 8 chars |
| `QP_BANK_DIR`, `QP_BANK_KEEP_PREFIX` | unset / `gusto-` | folder of a verified bank loaded at start (section 12); `infra/deployment/load-bank.sh` |
| `BLIND_DATA_KEYS` (you) | `id:base64key,...` | empty = personal quizzes unavailable in production; ids `[A-Za-z0-9_-]{1,32}`, keys exactly 32 bytes |
| `TRUST_PROXY_HOPS` | `1` | number of proxies in front; with `0` every visitor looks like the proxy's address and shares one rate-limit bucket |
| `SERVE_WEB`, `SERVE_ADMIN` | `1` | the image contains both built apps |
| `QP_ALLOW_DEV_SEED`, `QP_SEED_DEV` | `0` | `QP_ALLOW_DEV_SEED=1` makes the server refuse to boot in production |
| `RATE_LIMIT_SCALE` | unset (`1`) | must be 1 in production |
| `DEFAULT_ROOM_TIER` | unset = `FREE` in production | `FULL` unlocks everything for every room: only for a free launch |
| `LOG_LEVEL` | `info` | tokens, cookies, `reconnectToken` are redacted from logs |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | inside the container only |
| `MAX_WS_CONNECTIONS` / `MAX_WS_PER_IP` | 5000 / 40 | per-address cap matters for a venue where many phones share one Wi-Fi address; raise `MAX_WS_PER_IP` for big venues; creating rooms is limited to 10 per hour per address (burst 10), so one venue with several TVs behind one address can hit it |
| `MAINTENANCE_INTERVAL_MS` | 900000 (15 min) | question maintenance and all retention jobs; `0` switches it off |
| `RETENTION_OTP_HOURS`, `RETENTION_ACCOUNT_SESSION_DAYS`, `RETENTION_SECURITY_EVENT_DAYS`, `RETENTION_TELEMETRY_DAYS`, `RETENTION_CLOSED_ROOM_DAYS` | 24, 7, 180, 180, 30 | retention periods (`docs/PRIVACY.md` section 3); the privacy page states the defaults, change it with them |
| `PAYMENTS_ENABLED` and `APPLE_*`, `GOOGLE_*` | off | in-app purchases; only when the stores are set up (`docs/MOBILE.md` owner checklist, `docs/EXTERNAL_CHECKLIST.md`) |
| `PAYMENTS_ACCEPT_SANDBOX` | `1` | accepts store test purchases as real entitlements; set `0` once review passes |
| `AI_DECOYS_*`, `AUDIT_*`, `EMBEDDINGS_*` | unset | optional model services; names are never built in |

Adding a variable to `.env` is not enough: it must also appear in the `environment:` block of
`docker-compose.prod.yml`. Apply a change with `docker compose -f docker-compose.prod.yml up -d` (recreates
the app container; running games survive a restart, see section 0).

## 9. Updating to a new version

```
cd quizparty && git pull
cd infra/deployment
docker compose -f docker-compose.prod.yml up -d --build
```

Back up first (`docs/BACKUP.md`). Migrations are forward-only and applied by the entrypoint under a database
advisory lock; there is no automatic rollback. To go back, restore the pre-update backup and the old code.
`docs/RELEASE_CHECKLIST.md` lists what to check before and after.

## 10. Check that it works

- `https://<domain>/` loads; the padlock is valid (certificate issued by Caddy; first issuance can take a minute
  after the first start; `docker compose ... logs caddy` shows any problem `[UNTESTED HERE]`).
- Open `/tv` on the TV, scan the QR code with a phone on mobile data (proves different-network join, acceptance D).
- `curl -H "Authorization: Bearer <METRICS_TOKEN>" https://<domain>/metrics` shows `qp_ws_connections`,
  `qp_rooms_active`, `qp_room_input_seconds`, `qp_security_events_total`.
- Set an outside uptime monitor (any free one) on `https://<domain>/readyz`; it returns 503 when the database
  is unreachable or a migration is pending. There are no alert rules in the repository: `infra/monitoring/` is empty.

## 11. What this guide does not cover

TLS other than Caddy's automatic certificates, several servers, a managed database, a CDN (ADR-0003 allows one
in front of the static files), an IP allow-list for `/admin` (ADR-0018 mentions it; it is **not implemented** in
the server - Caddy `@admin path /admin* /v1/admin*` with `remote_ip` matchers can do it `[UNTESTED HERE]`),
store submission (`docs/MOBILE.md`), legal texts (`docs/EXTERNAL_CHECKLIST.md`).

## 12. Render, one paying venue (`render.production.yaml`)

The demo blueprint `render.yaml` runs development mode with the development bank; **never use it for a paying venue.**
`render.production.yaml` is the production counterpart; the owner's phone-only walk-through is `docs/GUSTO_GO_LIVE.md`
(Turkish). What it sets and why:

- `NODE_ENV=production` (fail-closed config checks), `QP_ALLOW_DEV_SEED=0`, `QP_SEED_DEV=0`, `QP_SEED_DEMO=0`. The
  entrypoint additionally ignores the two seed flags in production, and the question CLI refuses `seed` and
  `--allow-dev-seed` there; the server never serves `is_dev_seed` rows (ADR-0014).
- **Paid plans:** web `starter` (always on; the free plan sleeps after 15 idle minutes, so the first guest waits about
  a minute for a cold start and open tables could be disturbed) and Postgres `basic-256mb` (persistent, with Render's
  backups; a free Postgres expires after 30 days and is deleted). Plan names change: if Render rejects one, pick the
  cheapest paid web and Postgres plans in the dashboard `[UNTESTED HERE]`.
- One instance only (`numInstances: 1`), database reachable only from inside Render (`ipAllowList: []`),
  `/healthz` health check, `autoDeploy: false` (a push never changes the live venue; deploy by hand after a rehearsal).
- Secrets: `SERVER_SECRET` and `METRICS_TOKEN` are generated by Render (`generateValue`); `ADMIN_BOOTSTRAP_EMAILS`,
  `PUBLIC_WEB_URL`, `ALLOWED_ORIGINS`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `BLIND_DATA_KEYS` are
  `sync: false`: typed in the dashboard once, not in git. `pnpm release:audit` fails if a dev flag appears, a secret
  is inlined, a free plan or a second instance is declared, or the environment no longer loads in production.
- Look: build arguments `VITE_DEFAULT_THEME=gusto`, `VITE_VENUE_NAME`, `VITE_VENUE_CREDIT` (the Dockerfile passes them to
  the web build).
- Bank: `QP_BANK_DIR=/app/seed/gusto` makes the entrypoint run `load-bank.sh` at every start: categories, every
  `questions.*.tr.jsonl` through the normal importer (it accepts `AI_ASSISTED`/`HUMAN` rows with sources, refuses
  `DEV_SEED`), optional external audit verdicts `audits.*.jsonl` (`question import-results`, the fact-check
  evidence), then `question audit --no-models --auto-activate` (only an arbiter PASS becomes ACTIVE; the rest waits in
  REVIEW), then `question retire-dev --keep-prefix gusto-` (a no-op with a log line if the CLI has no such command).
  Re-running is idempotent. Rows without a PASS verdict never reach players.
- Venue mode: the flag `venue.sessions` (database, off by default) is switched in `/admin` after the first sign-in.
- Rate limits: `TRUST_PROXY_HOPS=1` (Render's load balancer) and `MAX_WS_PER_IP=150` (all guests share the café's Wi-Fi
  address). If Render puts a second proxy in front, every guest shares one rate-limit bucket (harmless, but check
  `/metrics` `qp_security_events_total` after the rehearsal) `[UNTESTED HERE]`.

Custom domains: the server derives CSP `connect-src`, the QR address and the allowed origins from `PUBLIC_WEB_URL` and
`ALLOWED_ORIGINS`; sessions use host-bound `__Host-` cookies (`SameSite=Strict`) and the CSP says `frame-ancestors
'none'`. So a custom domain needs **no code change**, only those two variables; embedding the game in an iframe is
unsupported by design (`docs/GUSTO_GO_LIVE.md` section "Kendi alan adınla yayınlamak").
