# Admin console

Served by the realtime server under `/admin/` when `SERVE_ADMIN=1` (build it with `pnpm build:admin`;
`ADMIN_DIST` overrides the folder). It is a Turkish-only staff tool; every action is checked on the server.

## First sign-in
1. Set `ADMIN_BOOTSTRAP_EMAILS=you@example.com` (comma separated). That address becomes an administrator
   the first time it signs in; nobody else is ever promoted by configuration.
2. Mail: outside production, without a webhook, the six-digit code is printed in the server log. Production
   needs the webhook transport (`EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN`); without it email sign-in is off.
3. Open `/admin/`, enter the address, then the code. Admin sessions end after 1 h idle / 12 h absolute.

## Roles
`ADMIN` everything · `EDITOR` questions, audit, categories · `MODERATOR` reports, queue, rooms, bans, incidents ·
`SUPPORT` read-only oversight. At least one active administrator must remain.

## Working the bank
Import (dry run first) → audit (models if `AUDIT_*` is configured, otherwise heuristics only, or export a
file for an outside reviewer and upload the results) → review queue → open a question → approve (naming
what you accept), reject, edit or retire. Everything staff change appears in the audit log.

## Development
`pnpm --filter @quizparty/admin dev` (port 5174, proxies `/v1` to `QP_API_TARGET`).
