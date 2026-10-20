# Backup and restore

What is stored where, how to copy it out, how to put it back, and how long to keep copies. The
dump/restore commands below were **run for real in the build sandbox against PostgreSQL 16** (a 340-question
database: dump 0.3 s, 450 kB, restore into an empty database 0.7 s, the app's migration runner then reported
"already applied: 7"). The Docker wrappers (`docker compose exec`) and the scheduled job are `[UNTESTED HERE]`.

## 1. What must be backed up

| Item | Where | Why | Loss means |
|---|---|---|---|
| The PostgreSQL database | Docker volume `quizparty_db-data` | accounts, roles, questions and their audit history, purchases and entitlements, flags, bans, reports, game records, personal quizzes | everything above is gone |
| `.env` (esp. `SERVER_SECRET`, `BLIND_DATA_KEYS`) | `infra/deployment/.env` | keys that make stored hashes and sealed answers usable | with the database restored but a different `SERVER_SECRET`: everyone is signed out, old links/invites stop working, purchase look-ups by token stop matching (see RUNBOOK "SERVER_SECRET"); without `BLIND_DATA_KEYS`: sealed Blind Quiz answers are unreadable (they are deleted after 30 days anyway) |
| Caddy volume `caddy-data` | Docker volume | certificates | re-issued automatically (rate-limited by Let's Encrypt), nothing lost |

**Store `.env` separately from the database dumps** (a password manager or an encrypted offline copy). A dump
holds sealed Blind Quiz answers; the key that opens them must not sit next to it.

## 2. Taking a backup

Custom-format dump (compressed, restorable table by table):

```
cd quizparty/infra/deployment
mkdir -p ~/backups
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U quizparty -Fc quizparty > ~/backups/quizparty-$(date +%F-%H%M).dump
```

Check it is not empty: `ls -l ~/backups` (the sandbox database with 340 questions was 450 kB; a real bank is larger).
Prove it is readable without restoring: `pg_restore -l file.dump | head`.

### Automatic daily backup `[UNTESTED HERE]`

```
crontab -e
# every night at 03:15, keep going even if one run fails
15 3 * * * cd /home/ubuntu/quizparty/infra/deployment && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U quizparty -Fc quizparty > /home/ubuntu/backups/quizparty-$(date +\%F).dump
```

(In crontab every `%` must be written `\%`.) Copy the files **off the server** (another provider's storage, your
own computer: `scp`, `rclone`, or the provider's snapshot feature). A backup on the same disk dies with the disk.

## 3. Retention (recommended; nothing enforces it)

Keep 7 daily, 4 weekly and 6 monthly dumps; delete older ones. Example for the daily folder:
`find ~/backups -name 'quizparty-*.dump' -mtime +7 -delete` (check the result of `-mtime` before trusting it).

A privacy consequence to plan for: **a deletion request is not applied to old backups.** State in your privacy
text that deleted accounts disappear from backups when those expire (the monthly dumps set the longest period, 6
months in this recommendation), and when you restore a backup, repeat the deletions made since. Keep your own dated list of erasure requests you served: a person who deletes their own account (`DELETE /v1/me`) leaves no entry in the admin audit log, which records only staff actions (`user.status`, `user.roles`, `user.sign-out`, ...).

## 4. Restoring

Practice this once on a spare machine before you need it.

```
cd quizparty/infra/deployment
docker compose -f docker-compose.prod.yml stop app                      # no writes while restoring
docker compose -f docker-compose.prod.yml exec -T db psql -U quizparty -d postgres \
  -c "DROP DATABASE quizparty WITH (FORCE)" -c "CREATE DATABASE quizparty OWNER quizparty"
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U quizparty -d quizparty --no-owner --exit-on-error < ~/backups/quizparty-2026-10-18.dump
docker compose -f docker-compose.prod.yml up -d app
```

Then open `/readyz` (200 = database reachable and every migration applied). If the dump is from an older version,
`up -d app` applies the newer migrations at start. Commands verified in the sandbox (same flags, local PostgreSQL 16):
dump `pg_dump -Fc`, restore `pg_restore --no-owner --exit-on-error` into a fresh database, then
`pnpm --filter @quizparty/db run migrate` printed `applied: (none); already applied: 7`.

Not tested: what a restored server does with rooms that were open when the dump was taken (it recovers active rooms from the durable log like after a crash, ADR-0006, but phones holding newer tokens will have to rejoin). Finished games and accounts are plain rows and come back intact.

## 5. Rotating the Blind Quiz data keys (`BLIND_DATA_KEYS`)

Format: `id:base64key,id:base64key`, each key exactly 32 random bytes (`config.ts` rejects anything else and a
repeated id). **The first entry seals new answers; every listed key can open old ones** (`Sealer`, ADR-0015). Each sealed
row stores its key id (`blind_responses.key_id`), so rotation never needs downtime:

1. Make a new key: `echo "k2:$(openssl rand -base64 32)"`.
2. In `.env` put it **first** and keep the old one: `BLIND_DATA_KEYS=k2:NEWKEY,k1:OLDKEY`. Apply:
   `docker compose -f docker-compose.prod.yml up -d`.
3. New answers are sealed under `k2`. Old answers still open under `k1`. There is no re-sealing tool.
4. Quizzes and everything under them are hard-deleted 30 days after last use (`RETENTION_MS` in `blind/vault.ts`,
   purged by the maintenance job every 15 minutes, `personal_quizzes.retain_until`). When no row uses `k1` any more,
   remove it. Check:
   ```
   docker compose -f docker-compose.prod.yml exec -T db psql -U quizparty -d quizparty \
     -c "SELECT key_id, count(*) FROM blind_responses GROUP BY key_id"
   ```
   Only retire a key when its count is 0 and no backup you may still restore needs it (a restored backup
   holds rows sealed under the keys of that day: keep old keys as long as you keep such dumps, at most 6 months
   with the retention above, or accept that restored old Blind Quiz answers are unreadable).
5. Removing a key that rows still use makes those answers unreadable (opening fails with "unknown key id"); the
   rest of the system is unaffected.
6. A leaked key: rotate as above, then delete the affected personal quizzes (RUNBOOK) - without re-sealing, old rows
   remain readable with the leaked key until they expire or are deleted.

If `BLIND_DATA_KEYS` is empty in production, personal quizzes are unavailable (no key is guessed). Outside
production a key derived from `SERVER_SECRET` is used; never rely on that.

## 6. Restore drill checklist (do it every quarter)

- [ ] Fetch the newest off-server dump to a spare machine.
- [ ] Restore into an empty database; `SELECT count(*) FROM questions, accounts, entitlements` look plausible.
- [ ] Start the app against it with the matching `.env`; `/readyz` is 200; you can sign in to `/admin/`.
- [ ] Write the date and the dump size below.

| Date | Dump | Result |
|---|---|---|
| 2026-10-18 (sandbox, 340 dev questions, local PG16, not production) | 449,518 bytes | restored, 340 questions, migrations "already applied: 7" |
