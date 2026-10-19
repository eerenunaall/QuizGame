# Runbook: when something happens

Commands assume you are in `quizparty/infra/deployment` on the server and write `dc` for
`docker compose -f docker-compose.prod.yml` (run `alias dc='docker compose -f docker-compose.prod.yml'`).
The admin console is `https://<domain>/admin/`. Procedures that depend on Docker or the public internet are
`[UNTESTED HERE]`; the application behaviour they rely on is cited from the code.

## 1. First look (any incident)

1. `dc ps` - are `db`, `app`, `caddy` running? `dc logs --tail 100 app` - last errors.
2. `https://<domain>/healthz` (process up) and `/readyz` (database reachable, migrations applied; 503 otherwise).
3. `curl -H "Authorization: Bearer $METRICS_TOKEN" https://<domain>/metrics | grep -E "qp_(ws_connections|rooms_active|errors_total|security_events_total)"`.
4. Admin console: Overview/Stats, Security events, Rooms, Incidents. Write an incident entry (Incidents) while you work;
   it is your timeline.

Restarting is safe: `dc restart app`. Running games are rebuilt from the durable log when the server comes back (ADR-0006);
phones reconnect by themselves (measured: 180 clients cut at once were all back within about 1.6 s, `docs/PERF.md`).

## 2. Symptoms

| Symptom | Likely cause | Do |
|---|---|---|
| Site unreachable, browser says certificate error | DNS not pointing here, ports 80/443 closed, or Caddy cannot get a certificate | `dc logs caddy`; check the A record and firewall |
| Site loads, TV says it cannot connect | app down or restarting | `dc ps`, `dc logs app`; `/readyz` |
| `/readyz` = 503 | database down or a migration is pending | `dc logs db`; `dc restart db`; if pending, `dc up -d --build app` applies migrations |
| App restarts in a loop | invalid production settings (message names the variable) | fix `.env`, `dc up -d` |
| Nobody can sign in to the console | mail path broken (webhook down/wrong), or flag `auth.email_login` turned off, or no `EMAIL_WEBHOOK_URL` | check the mail service; `dc logs app | grep -i mail`; flip the flag back using SQL below if you locked yourself out |
| "Too many requests" for a venue | many phones/TVs share one public address: room creation is limited to 10 per hour per address; `MAX_WS_PER_IP` is 40 sockets | wait, or raise `MAX_WS_PER_IP` and restart; room-create limit cannot be raised without `RATE_LIMIT_SCALE` (forbidden in production) |
| Everybody shares one limit / bans hit everyone | `TRUST_PROXY_HOPS` is 0 behind Caddy | must be `1` (compose sets it) |
| Disk filling | Docker logs or backups | section 8 |

Locked out by a flag, re-enable from SQL (no console needed):
`dc exec -T db psql -U quizparty -d quizparty -c "UPDATE feature_flags SET enabled = true WHERE key = 'auth.email_login'"`
(takes effect within 15 seconds, the flag cache lifetime).

## 3. Kill switches (turn something off fast)

Admin console, Flags (ADMIN only, audited as `flag.set`; each takes effect on this server at once and elsewhere
within 15 s; code: `flags/service.ts`). Defaults come from migration `0004_content_operations.sql`.

| Switch | Default | When off | Use when |
|---|---|---|---|
| `mode.blind_quiz` | off | Blind Quiz routes refuse (creating, responding) | a privacy incident in personal quizzes |
| `mode.custom_quiz` | off | Custom Quiz refuses | abuse of user-written questions |
| `mode.who_said_it` | off | the Who Said It mode cannot be built into a deck | abusive statements |
| `ai.decoys` | off | AI decoy suggestions fall back to the target's own alternatives | the model provider misbehaves or leaks |
| `auth.email_login` | **on** | e-mail sign-in request is refused | mail abuse, a flood of sign-in requests |
| `report.questions` | **on** | players cannot report a question | report flooding |
| `content.current_events` | **on** | questions of the current-events pool are not served | a news item went stale or sensitive |
| `sabotage.noise`, `auth.apple`, `auth.google` | off | **nothing: no code reads them** | do not use |

Other switches that are not flags:

| Switch | How | Effect |
|---|---|---|
| Stop all purchases | `PAYMENTS_ENABLED=0` in `.env`, `dc up -d` | verifiers are not created; purchase routes cannot verify |
| Stop personal quizzes completely | empty `BLIND_DATA_KEYS`, `dc up -d` | no sealer: personal quizzes unavailable (existing sealed rows stay in the database) |
| Stop sign-in mail | empty `EMAIL_WEBHOOK_URL`, `dc up -d` | production fails closed: no e-mail sign-in |
| Take the site down | `dc stop app` (Caddy shows 502) | |
| Pull a question | console: question -> transition to a non-active state (a MODERATOR may do this) | it leaves play |
| Hide a category | console: Categories -> disable | |
| Close a room / remove a player | console: Rooms -> close; player -> ban | `room.close`, `ban.create` in the audit log |
| Ban | console: Bans (IP hash, device hash or account; with expiry and reason) | applies at room creation, sign-in, join and connection |
| Suspend an account / sign someone out | console: Users -> status `SUSPENDED` / sign-out | `user.status`, `user.sign-out` |
| Maintenance job off | `MAINTENANCE_INTERVAL_MS=0` | question maintenance, personal-quiz retention and every other retention job (`RETENTION_*`, `docs/PRIVACY.md` section 3) stop (do not leave off) |

## 4. Security incident (suspected breach or leak)

1. Contain: `dc stop app` if data may be leaving; otherwise flip the relevant kill switch (section 3).
2. Preserve: `dc logs app > ~/incident-$(date +%F).log`; take a database dump (`docs/BACKUP.md`) before changing anything.
3. Look: console Security events (kinds such as `CSRF_REFUSED`, `ADMIN_FORBIDDEN`, `WS_ORIGIN_REJECTED`), Audit log (every admin write:
   who, when, from which pseudonymous address).
4. Rotate what could have leaked (section 5), sign everyone out (SERVER_SECRET change does it; or per user in the console).
5. Tell people: KVKK and GDPR both oblige you to notify the authority (and, depending on risk, the persons) of a personal-data breach within short
   deadlines. The deadlines and whether a given incident qualifies are **owner/counsel decisions** (`docs/EXTERNAL_CHECKLIST.md`): ask counsel the same day.
   Keep the incident entry as your record.

## 5. Rotating secrets

| Secret | How | Consequence |
|---|---|---|
| `METRICS_TOKEN` | new value in `.env`, `dc up -d`, update your monitor | none else |
| `EMAIL_WEBHOOK_TOKEN` / URL | change at the mail service and in `.env`, `dc up -d` | sign-in codes fail until both match |
| `POSTGRES_PASSWORD` | `dc exec -T db psql -U quizparty -d postgres -c "ALTER USER quizparty PASSWORD 'NEWPASSWORD'"`, then the same in `.env`, `dc up -d` (use letters and digits only) | brief reconnect |
| `GOOGLE_WEBHOOK_SECRET` | new value in `.env`; update the push URL in Google Cloud Pub/Sub (`/v1/webhooks/google/<secret>`) | store notifications refused until both match |
| `BLIND_DATA_KEYS` | prepend a new key, keep the old until unused: `docs/BACKUP.md` section 5 | none |
| `SERVER_SECRET` | **no rotation tool exists.** Changing it re-keys every stored hash without migrating the old ones | everybody is signed out (account sessions), pending sign-in codes die, Blind Quiz invites and respondents' claim cookies stop matching (targets can no longer open or delete their answers; they expire in 30 days), unlock links die, IP/device bans stop matching, purchase-token look-ups for existing purchases stop matching (restore and refund notifications for old purchases may not find them: verify with a sandbox purchase afterwards), report pseudonyms reset. Do it only after a confirmed compromise, outside play hours, with a fresh backup |
| Admin or user session suspected stolen | console Users -> sign-out; for everyone: `DELETE /v1/me/sessions` per user or a `SERVER_SECRET` change | |

## 6. Account deletion and data requests

Self-service: a signed-in person calls `DELETE /v1/me` with `{"confirm":"DELETE"}` (the mobile app's Profile screen does;
the web app has no button yet). Export: `GET /v1/me/export` (`docs/PRIVACY.md` section 4 lists what each covers and omits).

When someone writes to you instead:

1. Confirm it is them: reply to the address on file and ask for the request in that thread (or let them sign in and
   show a code). Log the date, the request, who handled it.
2. Export first if they asked for a copy (it includes the quizzes they created); a person who was only a Blind Quiz target
   has no account: find them by display name (`docs/PRIVACY.md` section 6).
3. Erase: `dc exec app pnpm ops:delete-account --email person@example.com` shows what it found; add `--yes` to delete. The container already
   has `DATABASE_URL` and `SERVER_SECRET`. It runs the same code as `DELETE /v1/me` (verified in the sandbox on a throwaway database: the account
   becomes `DELETED`, e-mail and name are cleared, a second run reports nothing to delete); the `dc exec` wrapper is `[UNTESTED HERE]`. If the account is
   staff it refuses: remove the roles in the console first.
4. Third parties named in a personal quiz: the respondent deletes their own answers with their invite link. If they cannot, there is no console
   button for removing someone else's quiz unless it was reported (console, Reports → personal-quiz reports → delete quiz); otherwise use SQL: `DELETE FROM personal_quizzes WHERE id = '...'` (cascades to prompts, targets, sealed answers, custom questions).
5. Reply within 30 days saying what was done and that backups age out on their retention schedule (`docs/BACKUP.md`).
6. Rooms and game history are keyed by random ids and nicknames and are not tied to the account; if the person gave a nickname that
   identifies them and asks for removal, delete that room now (`DELETE FROM rooms WHERE id = '...' AND status = 'CLOSED'`, cascades);
   otherwise the retention job removes it 30 days after it closed (`docs/PRIVACY.md` section 3).

## 7. Payments

- A refund arrives as a store notification (`/v1/webhooks/apple`, `/v1/webhooks/google/<secret>`); the entitlement is revoked and a TV
  in a live room falls back at its next game (`docs/MOBILE.md` device pass). A refund cannot be restored.
- Sandbox purchases are accepted while `PAYMENTS_ACCEPT_SANDBOX=1`. Turn it to `0` after store review so test purchases stop granting.
- A person says "I paid but have nothing": ask them to use Restore in the app (works across devices); check Users -> the account's purchases in
  the console; Apple/Google receipts are the proof. No payment is verified on the client.

## 8. Housekeeping

- **Docker log size.** Without a limit container logs grow forever. Set once in `/etc/docker/daemon.json`:
  `{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}` then `sudo systemctl restart docker`, then `dc up -d --force-recreate`.
- Disk: `df -h`, `docker system df`, `dc exec -T db psql -U quizparty -d quizparty -c "SELECT pg_size_pretty(pg_database_size('quizparty'))"`.
- Updates: `docs/DEPLOYMENT.md` section 9. OS security updates: `sudo apt update && sudo apt upgrade`, reboot at a quiet hour.
- Backups: nightly, off-server, restore drill each quarter (`docs/BACKUP.md`).

## 9. Who to call

Fill in before launch: hosting provider support, domain registrar, mail service, the person who can approve a security
notification to the authorities.
