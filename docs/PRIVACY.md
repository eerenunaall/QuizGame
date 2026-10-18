# Privacy: data inventory, retention, deletion

An engineering inventory built from the database migrations (`database/migrations/0001..0007`) and the code that
reads and writes them. It is the factual basis for a privacy policy; it is **not** the policy and **not legal
advice**. Open legal questions are collected in `docs/EXTERNAL_CHECKLIST.md`. Where this file says "not enforced"
it means exactly that: the rule is in ADR-0018/0015 but no code applies it yet.

## 1. Principles that the code does enforce

- Players are pseudonymous: a nickname and a random session id; no account is needed to play.
- Addresses and device ids are never stored raw: `pseudonym()` (HMAC-SHA-256 keyed with `SERVER_SECRET`, truncated) for
  IPs and devices; `hmacHex()` for tokens and one-time codes (`security/crypto.ts`). Tokens are stored as hashes.
- Telemetry accepts only allow-listed property names with primitive values per event name, never nicknames or
  answers (`telemetry/sink.ts`).
- Log redaction of `authorization`, `cookie`, `reconnectToken` and `token` fields (`app.ts`); canary test
  `blind-canary.test.ts` proves a planted personal answer appears in no log line, metric, error body, header or
  database cell outside the sealed column.
- Blind Quiz answers are sealed with AES-256-GCM, opened only inside the vault module, and never returned to the
  quiz creator (acceptance AB).
- No cookies for players. Accounts (browser sign-in) use one `HttpOnly; SameSite=Strict` session cookie, `Secure` in production.
  The Blind Quiz respondent gets one `HttpOnly; SameSite=Strict` claim cookie. No analytics or advertising cookies, no third-party scripts
  (CSP `script-src 'self'`, `connect-src 'self'` plus this host's websocket).

## 2. Data inventory

| Data | Table / place | Personal? | Why | Kept | Removed by |
|---|---|---|---|---|---|
| Nickname, avatar, answers, powers used, scores of a room | room input log `room_events.input`, `rooms.snapshot`, `room_sessions` (hashes), `games`, `game_players`, `game_rounds`, `game_answers`, `score_deltas` | nickname is free text (may be a real name); ids are random | run the game, crash recovery, statistics | **no purge job exists**: kept until removed by hand (ADR-0018 states 30 days) | for rooms holding personal content (`sensitiveContent`): `room_events` and `snapshot` erased when the room closes (`store.scrubRoom`); otherwise manual SQL (section 5) |
| Session token (hash), device-in-room hash, global device hash | `room_sessions` | pseudonym | reconnect, bans | as above | `room_sessions` rows are marked `LEFT`/`KICKED`/`EXPIRED`, not deleted; manual SQL (section 5) |
| Pseudonymised IP (room creation, security events, rate limits) | `security_events.ip_hash`, `email_otps.ip_hash`, `admin_audit.ip_hash`, in-memory rate-limit buckets | pseudonym | abuse control | `security_events` has **no purge job** (ADR-0018 states 180 days); rate-limit buckets are in memory and swept after 15 idle minutes | manual SQL |
| Telemetry events | `telemetry_events` (`actor` is a pseudonym) | pseudonym | product statistics | **no purge job** | manual SQL |
| Account: e-mail, verified time, display name, avatar, locale, status, last login | `accounts` | **yes** | sign-in, purchases, personal quizzes, staff | until deletion | account deletion (section 4) |
| Account sessions | `account_sessions` (token hash, kind, times) | pseudonym | stay signed in: web 30 days sliding, admin 1 h idle / 12 h absolute | revoked or expired rows remain; `purge()` (7 days after expiry/revocation) exists but **is not scheduled** | manual SQL |
| Sign-in codes | `email_otps` (hash of the address, hash of the code, ip hash, attempts) | pseudonym | one-time codes valid 10 min | `purge()` exists but **is not scheduled** (ADR-0018 states 24 h) | deletion of the account removes codes for that address (`otp.forget`); otherwise manual SQL |
| Staff roles | `account_roles` | yes (links to the account) | access control | while staff | demotion by an administrator |
| Staff actions | `admin_audit` (actor account id, action, target, detail, ip hash) | yes (actor id) | accountability | no purge job | not removed by account deletion (staff cannot self-delete, section 4) |
| Purchases | `purchase_transactions` (store transaction id, purchase-token hash, status, environment, `raw_summary`), `entitlements`, `store_notifications` | linked to an account while it exists | prove entitlements, refunds, accounting | purchase rows are kept after account deletion with the account link cut and a keyed tombstone (`former_account_ref`) | entitlements deleted with the account; transactions anonymised, not deleted (legal basis for keeping them is for counsel to confirm) |
| TV unlock links | `link_intents` | pseudonym | let a signed-in phone unlock a TV room | short-lived; a room's expired links are deleted whenever it creates a new one (`links.create`) | account deletion clears `claimed_by` |
| Question reports | `question_reports` (reporter hash, optional `note`) | pseudonym; the note is free text | content quality | no purge job | manual |
| Bans | `bans` (hash of IP/device, or account id, reason) | pseudonym | abuse control | until `expires_at` / lifted; rows stay | manual |
| Incidents | `incidents`, `incident_notes` | free text written by staff | operations | no purge job | manual |
| **Personal quizzes** (Blind Quiz, Custom Quiz, Who Said It) | `personal_quizzes`, `blind_prompts`, `blind_targets` (display name, invite hash, claim hash, consent time), `blind_responses` (sealed answer + decoys, key id), `custom_questions` | **yes** and about third parties | the personal-quiz modes | hard-deleted `retain_until` = 30 days after last use (maintenance job every 15 min; `QuizService.purgeExpired`) | see section 6 |
| Server logs | container stdout (Docker's log driver) | pseudonyms only by design | operations | Docker default: unlimited until rotated - **set a log size limit** (RUNBOOK) | host operator |
| Backups | your off-server dump files | everything above | recovery | your retention (`docs/BACKUP.md`) | expiry of the backup |

What is **not** collected: precise location, contacts, advertising ids, payment card data (the stores handle
payment; the server sees store transaction identifiers and a receipt summary), microphone/camera (the TV page
sends `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`).

## 3. Retention: what is real today

| Rule in ADR | Enforced? |
|---|---|
| Personal quizzes deleted 30 days after last use | **Yes** - `QuizService.purgeExpired` runs on the maintenance timer; test `blind-quiz` (retention) |
| Room traces of personal-content rooms erased at close | **Yes** - `scrubRoom`; test `personal-quiz.test.ts` (traces erased at close) |
| Room events/sessions 30 days | **No scheduled job** |
| Security events 180 days | **No scheduled job** |
| OTP rows 24 h | **No scheduled job** (rows are single-use and expire after 10 minutes, but stay in the table) |
| Statements 24 h after room close (Who Said It) | Statements live in the room input log; they are erased at close for rooms flagged as holding personal content (same `scrubRoom` path, covered by `who-said-it.test.ts` "traces erased at close") |
| Account sessions purge | `purge()` exists, **not scheduled** |

Until the missing jobs are added (listed as open in `docs/FINAL_RELEASE_AUDIT.md`), run the retention SQL of section 5
monthly. It is plain `DELETE` statements; try them on a restored copy first.

## 4. Data subject rights (KVKK art. 11 / GDPR art. 15-17, as implemented)

| Right | What exists | Limits |
|---|---|---|
| Access / copy | `GET /v1/me/export` (signed in) returns JSON: account, roles, session metadata, purchases, entitlements | **does not include** the person's personal quizzes (titles, prompts, custom questions) or the nicknames they used in rooms; a support request must cover these by SQL (section 6) |
| Erasure | `DELETE /v1/me` with body `{"confirm":"DELETE"}`: removes e-mail, display name, avatar; revokes all sessions; deletes personal quizzes with everything under them; deletes entitlements; unlinks purchases (tombstone); gives the account a new store token so old purchases can never bind to it again; deletes pending sign-in codes | **Staff accounts are refused (409)**: an administrator removes the roles first (admin console, Users). Room history keyed only by random ids/nicknames is not linked to the account and is not touched. Backups are not edited |
| Sign out everywhere | `DELETE /v1/me/sessions` | |
| Rectification | display name/locale: no self-service endpoint beyond sign-in; staff cannot edit e-mail in the console | by SQL on request |
| Objection / restriction | account `SUSPENDED` status (admin console) | |
| Third parties in Blind Quiz | the target consents before anything is stored (`consented_at`), sees their own answers, can approve each question for play, and can delete everything at once: `DELETE /v1/blind/respond/:token` (needs the claim cookie from consent) | |

Serving a request by hand: verify the person controls the address by letting them sign in, then use the endpoint
through their session; if they cannot, ask them to reply from the address on file. Record the request date and
what you did. Respond within 30 days (the KVKK and GDPR periods; counsel to confirm).

## 5. Retention SQL for the jobs that do not exist yet

Run as the database user in `psql` (`docker compose -f docker-compose.prod.yml exec -T db psql -U quizparty -d quizparty`).
Take a backup first.

```sql
-- closed rooms older than 30 days (cascades to events, sessions, games, rounds, answers, scores)
DELETE FROM rooms WHERE status = 'CLOSED' AND closed_at < now() - interval '30 days';
-- security events older than 180 days
DELETE FROM security_events WHERE at < now() - interval '180 days';
-- telemetry older than 180 days
DELETE FROM telemetry_events WHERE at < now() - interval '180 days';
-- sign-in codes older than a day
DELETE FROM email_otps WHERE created_at < now() - interval '1 day';
-- dead web/admin sessions older than 7 days
DELETE FROM account_sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days';
```

(The cascade from `rooms` follows `ON DELETE CASCADE` in migration 0001 for `room_events`, `room_sessions` and
`games`; `game_players`/`game_rounds`/`game_answers`/`score_deltas` hang off `games`. Check on a copy that the
statistics you want to keep are not needed, because this removes finished-game records of those rooms.)

## 6. Personal-quiz specifics (ADR-0015)

- Creators build quizzes about friends: a quiz has a title, prompts, and **targets** (a display name per person).
  A target receives an invite link (a 256-bit token whose keyed hash is stored). Opening the link shows the consent step; nothing
  is stored before the target agrees. The first consent mints a claim secret kept in the target's browser; later
  steps need it, so the creator who also holds the link cannot read or delete answers (red-team ATTACK 10).
- Answers and decoys are stored only sealed (AES-256-GCM, key id + AAD binding row and prompt). The creator's API has no read path for them.
  During a game the answer appears in the room's memory and, until the room closes, in the room's durable input
  log; the log and snapshot are erased when the room closes (`scrubRoom`).
- The optional AI decoy suggestion (flag `ai.decoys`, off by default, needs `AI_DECOYS_*`) would send the target's answer to
  the configured model provider. That is a transfer to a third party and needs its own notice and consent text before the flag is turned on.
- Subject-access for a third party who is not an account holder: they hold the invite link, so they see their own
  answers in the respond page and can delete them. Without the link, search by display name in `blind_targets`.
- A creator's quizzes are deleted with their account; all quizzes expire 30 days after last use.
- Who Said It statements are written by players; they are filtered by the nickname/statement filter and live
  in the room log (scrubbed at close, above).

## 7. Cross-border transfer, processors, lawful basis (for counsel)

Processors that would receive personal data in a typical deployment: the VPS provider (everything), the
e-mail service (address + code), Apple/Google (store transaction identifiers; the server also calls their APIs), an
LLM provider only if `AUDIT_*`/`AI_DECOYS_*` are configured (question text; for AI decoys, personal answers). The lawful
basis per purpose (contract for accounts/purchases; legitimate interest for abuse control; consent for
Blind Quiz targets), VERBIS registration thresholds in Turkey, a data-processing agreement with the VPS and
mail providers, and whether a DPO or EU representative is needed are **owner/counsel decisions**
(`docs/EXTERNAL_CHECKLIST.md`).

## 8. Children

The game has no age gate. Players are anonymous nicknames; accounts need an e-mail address. App-store
age ratings and child-privacy rules (the stores and GDPR art. 8 have child rules; KVKK treatment is for counsel)
need the owner's decision before listing.
