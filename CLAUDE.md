# Quiz Party — working agreement for coding sessions

TV-first multiplayer quiz party game: **TV = stage, phone = controller, server = game master.**
Read in this order: `docs/STATUS.md` → `docs/PLAN.md` → the ADR relevant to your task → `docs/GDD.md`.
Sessions are ephemeral: commit and push to the designated branch after every green milestone.

## Hard rules

- The server is authoritative (timer, answers, score, legality, visibility). Clients send intents only.
- Never send unrevealed answers/hidden state to a client: build views with allow-lists, keep
  `.strict()` outbound schemas, keep the payload-scanner test green (ADR-0008).
- No mocked core paths; doubles only for remote systems and only speaking the real wire contract.
- Every bug → regression test first. Never skip/disable a flaky test.
- Money, auth and privacy rules in ADR-0012/0013/0015/0018 are not negotiable for speed.
- Do not open a pull request unless the owner asks. Do not put model identifiers in commits, code or docs.

## Commands (pnpm workspace)

```
pnpm install
pnpm check                 # lint + typecheck + unit tests (what CI's first job runs)
pnpm test                  # all unit tests;  pnpm test:integration | test:ws | test:red-team | test:e2e
pnpm build                 # all apps/packages
pnpm dev:db                # start Postgres (+Redis) in the sandbox and create the dev database
pnpm db:migrate            # apply database/migrations;  pnpm db:types  # regenerate Kysely types
pnpm dev                   # realtime + web
```

## Sandbox facts

Node 22, pnpm 10, PostgreSQL 16 (`scripts/dev/db-up.sh` starts it), Redis 7, Playwright Chromium at
`/opt/pw-browsers/chromium` (Playwright is pinned to 1.56.x to match; never run `playwright install`).
No Docker daemon, no Xcode/Android SDK, no apple.com access. See ADR-0019 for what is provable here.

## Where things live

`apps/realtime` (all backend logic) · `apps/web` (TV + browser controller) · `apps/admin` ·
`apps/mobile` · `packages/*` (shared libs; engine is pure) · `database/migrations` · `scripts/*` ·
`tests/*` (cross-cutting layers) · `docs/ADR/*` (decisions) · `docs/ACCEPTANCE.md` (A–AE matrix).

## Style

Comments explain why (invariants, spec refs like `GDD §8.2`), match surrounding density. User-visible
strings only in `packages/i18n`. Time and randomness are injected into pure logic.
