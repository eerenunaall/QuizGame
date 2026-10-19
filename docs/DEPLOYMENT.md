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

The server does not speak SMTP. It sends each sign-in code to a web address you provide
(`EMAIL_WEBHOOK_URL`) as `POST` with JSON `{"to": "...", "subject": "...", "text": "..."}` and, if
`EMAIL_WEBHOOK_TOKEN` is set, the header `Authorization: Bearer <token>` (`WebhookEmailSender`,
`apps/realtime/src/auth/email.ts`; a non-2xx answer counts as a failure). The code is in the subject and text.

- In production **without** `EMAIL_WEBHOOK_URL` e-mail sign-in is switched off (fail closed): you could not log in
  to the admin console. Outside production the code is printed in the log instead.
- Pick one: (a) a no-code automation tool (Make, Zapier, n8n) with a "webhook" start and a "send e-mail" step -
  paste the webhook address as `EMAIL_WEBHOOK_URL`; (b) a transactional-mail provider whose API accepts exactly this
  shape, or a few lines of adapter code at a small serverless endpoint. **No mail service has been tested against
  this server `[UNTESTED HERE]`.** Test it by signing in once (section 7) before relying on it.
- The sender address and domain authentication (SPF, DKIM) are set in that service, not here.

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

1. `ADMIN_BOOTSTRAP_EMAILS` must contain your address (section 3). Nobody is ever promoted by clicking.
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
| `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN` (you) | see section 5 | token at least 8 chars |
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
