# Release checklist

Tick every box for each release; paste the date and the git commit in the table at the end. `[auto]` = proven by a command; `[manual]` = a person looks.

## A. Code and CI (before tagging)

- [ ] `[auto]` `git status` clean on the release branch; CI green for the exact commit (all jobs: check, mobile, integration, e2e).
- [ ] `[auto]` `pnpm check` and `pnpm test:all` pass locally with PostgreSQL running.
- [ ] `[auto]` `pnpm test:e2e` passes.
- [ ] `[auto]` `pnpm release:audit` exits 0 and the regenerated `docs/FINAL_RELEASE_AUDIT.md` shows no `FAIL` and no `OPEN` row you have not accepted in writing; commit the regenerated file.
- [ ] `[auto]` `pnpm perf --rooms 20 --players 8` still within the numbers in `docs/PERF.md` (no worse than the previous run by more than the noise between its two runs); update the file if the code changed substantially.
- [ ] `[manual]` New migrations are forward-only, reviewed, and `pnpm db:types` leaves `packages/db/src/generated` unchanged.
- [ ] `[manual]` `docs/STATUS.md` and `docs/ACCEPTANCE.md` match reality.

## B. Production configuration (every deploy)

- [ ] `[manual]` `.env` on the server has every variable of `docs/DEPLOYMENT.md` section 8; no placeholder text; `DEFAULT_ROOM_TIER` unset unless you intend a free-for-all.
- [ ] `[manual]` `QP_ALLOW_DEV_SEED=0`, `RATE_LIMIT_SCALE` unset (the server refuses to start otherwise).
- [ ] `[manual]` `PAYMENTS_ACCEPT_SANDBOX=0` once store review has passed.
- [ ] `[manual]` Feature flags: `mode.*` and `ai.decoys` in the state you intend (`docs/RUNBOOK.md` section 3). Defaults are off.
- [ ] `[manual]` A fresh backup exists and the last restore drill is less than 3 months old (`docs/BACKUP.md`).
- [ ] `[manual]` Question bank: categories enabled, enough active questions per category and difficulty (the console shows counts), no development-seed rows (`SELECT count(*) FROM questions WHERE is_dev_seed` must be 0; the server does not serve them in production unless the dev-seed flag is on, which production refuses).

## C. After deploying

- [ ] `[manual]` `/healthz` and `/readyz` are 200; certificate valid; `/metrics` works with the token.
- [ ] `[manual]` Full game pass with one TV and at least three real phones, one on mobile data: join by QR, lobby settings, a game with every power, reload a phone and the TV mid-question, results, rematch.
- [ ] `[manual]` Admin sign-in works from a clean browser (proves the mail path), a report made by a phone appears in the console.
- [ ] `[manual]` Turkish and English both checked.
- [ ] `[manual]` Uptime monitor on `/readyz` is green and alerts reach a person.

## D. Mobile releases (only when shipping the app)

- [ ] `[manual]` Everything in `docs/MOBILE.md` "Owner checklist" and its device test pass.
- [ ] `[manual]` Store listing complete, privacy policy URL live, data-safety/privacy labels match `docs/PRIVACY.md`.
- [ ] `[manual]` Server `APPLE_*` / `GOOGLE_*` set, a sandbox purchase, restore and refund observed end to end.

## E. Gates from the brief (final release gate)

| Gate | Where it is checked |
|---|---|
| Monitoring works | `/metrics`, `/healthz`, `/readyz`; uptime monitor (C) |
| Backup strategy exists | `docs/BACKUP.md`, drill table |
| Release checklist exists | this file |
| Browser compatibility documented | `docs/BROWSER_MATRIX.md` (and the device pass) |
| No known critical security issue | `docs/SECURITY.md` section 3, `docs/RED_TEAM.md`, audit |
| Purchase verification works | acceptance U-X, store sandbox pass |
| Mobile fallback works | acceptance F (browser controller) |

## F. Rollback

Restore the pre-release backup and redeploy the previous commit (`docs/DEPLOYMENT.md` section 9). Migrations are forward-only: a rollback after a
migration needs the backup, not a down-migration.

## Release log

| Date | Commit | Done by | Notes |
|---|---|---|---|
| | | | |
