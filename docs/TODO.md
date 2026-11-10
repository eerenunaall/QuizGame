# What is left (ordered work list)

Written 2026-11-10 at commit `f12ff7d`. This is the single list of open work, from "must before go-live"
to "optional". Work top to bottom; tick an item here in the same commit that finishes it.

## Rules that cost us work when ignored

- **Push after every green milestone.** The sandbox is recycled without warning; unpushed work (also in
  agent worktrees under `.claude/worktrees/`) was lost once. Fetch, rebase, push; never force-push.
- Bug → failing regression test first. Never skip a test. Strings only in `packages/i18n` (tr + en).
- Source hygiene guard: no literal invisible/bidi characters in source, write escapes.
- Next free numbers: migration `0018`, red-team `ATTACK 90`.
- Gate before a final push: `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test &&
  pnpm run test:web && pnpm run test:integration && pnpm run test:ws && pnpm run test:red-team`, then
  `pnpm run build:web && pnpm run build:admin && pnpm exec playwright test` (about 18 minutes, 47 tests).
  PostgreSQL down (`ECONNREFUSED`) → `pnpm dev:db`.

## State at the time of writing

- GitHub CI on `f12ff7d`: lint, typecheck, unit (1162), web (382), integration (413), websocket (121),
  red-team and mobile jobs are green. The **browser job failed in its "Install Chromium" step** (about one
  second in), so the browser suite did not run on GitHub for this commit.
- Last full local browser run was one commit series earlier: 46 of 47 passed; the one failure was
  `DROP DATABASE ... permission denied to terminate process` (`packages/db/src/testing.ts:101`), a sandbox
  PostgreSQL problem; the spec passed alone.
- Owner decision (2026-11-10): **the AI path of the Soru Stüdyosu stays optional and off** (no key on the
  server). Questions are prepared with the owner's own chat assistant; the panel gets two key-free ways in
  (items A3a, A3b). The AI code stays, tested against the wire-contract double only.

## A. Must, before go-live

- [ ] **A1 Browser CI.** Read the failed job's log (run 42721529318, job 129516413506, step "Install
      Chromium"; `.github/workflows/ci.yml`), fix it, then get one full green browser run on the head commit
      (locally and on GitHub).
- [ ] **A2 Quiz night picture rounds do not show pictures.** A question's `imageUrl`
      (`packages/quiznight/src/types.ts`) is an outside address, but the web app's CSP is `img-src 'self'`
      (`apps/realtime/src/http/static-web.ts`). Do not loosen the CSP: add picture upload through the venue
      asset store (`apps/realtime/src/venue/images.ts`, `assets.ts`, `asset-routes.ts`, migration 0015) with a
      new kind and its own count limit, reference it by hash from the question, show it on the TV slide and
      the tablet. Regression test: a night with a picture question, TV frame carries only the hash path.
- [ ] **A3a Read a document that already holds questions (no model).** On top of `extractDocument`
      (`apps/realtime/src/venue/extract.ts`), parse text of the shape "question, A) B) C) D), Cevap: X,
      optional Açıklama" (also numbered, also "Doğru cevap", also a trailing answer key) into the same draft
      cards the AI path uses (`authoring-drafts.ts`, `packages/question-bank/src/authoring.ts`,
      `apps/web/src/venue/DocumentAuthoring.tsx`). Works with no `AUTHORING_*` key. Rows it cannot read are
      listed with the reason in Turkish. Drafts still need the owner's approval and the venue import checks.
- [ ] **A3b Paste box.** The owner pastes the text their own assistant produced (same shapes as A3a, plus the
      CSV/JSONL template of `docs/venue-question-template.md`) and gets the same draft cards.
- [ ] **A3c One browser test for the studio** (upload a small text file of formatted questions → drafts →
      approve all → listed under Sorular). The AI path keeps its integration and red-team tests; a run with a
      real key is optional and needs the owner's key.
- [ ] **A4 Owner guides.** `docs/VENUE.md` still says document questions are "henüz yapılmadı": rewrite the
      Soru Stüdyosu section (manual form, A3a, A3b, optional AI). Add the optional `AUTHORING_API_KEY`,
      `AUTHORING_MODEL` to `docs/GUSTO_GO_LIVE.md`, `render.production.yaml` (commented, `sync: false`) and
      `.env.example`. No model names in docs (the owner is told in chat).
- [ ] **A5 Finish the line-by-line security read** (tests exist, the read was interrupted): document
      extraction (`apps/realtime/src/venue/extract.ts`, `extract/core.mjs`, `extract/worker.mjs`), image
      validator (`images.ts`), quiz night TV views and routes (`packages/quiznight/src/views.ts`,
      `apps/realtime/src/venue/quiznight-routes.ts`, `quiznight-service.ts`), draft approval
      (`authoring-routes.ts`), display credentials (`displays.ts`, `display-routes.ts`). Every finding: test
      first, then fix.
- [ ] **A6 Send a quiz night to a paired TV from the panel.** Today the TV opens a night through a signed
      12-hour link (`/tv/gece?l=…`). Under `VENUE_LOCK` a paired display should receive it like a room:
      extend the display poll delivery (`displays.ts`, `display-routes.ts`,
      `apps/web/src/venue/DisplayPairing.tsx`) and add "Bu TV'de aç" in the quiz night screen;
      `QuizNightService.tvViewOf(nightId)` is the attach point. Red-team: another venue's display, a revoked
      display, a night of another venue.
- [ ] **A7 (owner) Production set-up**, with the phone-only guide `docs/GUSTO_GO_LIVE.md`: Render blueprint
      and secrets (`VENUE_LOCK=1` is in the blueprint), e-mail provider and domain records, DNS record for
      `quiz.archonbite.com`, the studio site on Netlify (`sites/archonbite/DEPLOY.md`) and the domain move,
      the Gusto venue and staff accounts in `/admin`, flag `venue.sessions` on.
- [ ] **A8 (owner + us) Rehearsal at Gusto**: real TV, phones, a tablet; one phone-game table and one Quiz
      Gecesi; listen to the sounds on the TV speakers; watch the Wi-Fi.

## B. Important, first weeks

- [ ] B9 Team logos (venue assets) inside the quiz night TV and tablet screens (colour + emoji badge today).
- [ ] B10 Pick quiz night questions from the global bank too (only the venue's own pool today).
- [ ] B11 Integration test: the server restarts in the middle of a quiz night and the night continues
      (replay is covered by engine property tests only).
- [ ] B12 Let a venue allow STAFF to run a quiz night (owner only today).
- [ ] B13 Docs: `docs/RED_TEAM.md` rows 80–89 (`tests/red-team/venue-authoring.test.ts`), `docs/STATUS.md`
      section for the studio's document path and the model adapter fix.
- [ ] B14 GitHub hand-over: a real `README.md` (what it is, how to run, where to deploy) and
      `docs/HANDOFF.md` (one page: what a site integrator must do). `main` holds only the initial commit;
      merging pull request 1 is the owner's decision.
- [ ] B15 (owner) Question bank: 73 questions wait in REVIEW; the ten-minute spot check in
      `docs/question-slices/OWNER-SAMPLE-CHECK.md` was not done.
- [ ] B16 (owner) Legal pages: 46 fill-in markers in the game and the site; a lawyer must read them.
- [ ] B17 (owner) Site: Gusto's permission for its name and logo, a real contact address in
      `sites/archonbite/assets/config.js`, a native read of the English text.
- [ ] B18 Re-encode uploaded logos instead of only validating them (residual decoder risk, ADR-0030).
- [ ] B19 Removing a paired TV leaves its metered table running until staff end it: end or hand it over.
- [ ] B20 Quiz night tablet screens were checked at 1024 px only: phone width and large tablets.

## C. Optional, later

- [ ] C21 Music rounds with uploaded audio.
- [ ] C22 Table-tablet mode (question and options on one tablet per table) for a tablet package.
- [ ] C23 "Balance teams" button; more than 8 players in team play.
- [ ] C24 Weekly house leaderboard on the idle TV; happy-hour extension preset.
- [ ] C25 Game ideas from the reference games: ask-the-crowd joker, hot-seat round, category crown.
- [ ] C26 Native app screens for teams and the panel (the store app is not shipped).
- [ ] C27 Global browser sales (Paddle), after the owner's talk with a lawyer
      (`docs/MONETIZATION_RESEARCH.md`).
- [ ] C28 Site extras: press kit, a Gusto case page, a "notify me" form.
- [ ] C29 In-café mini PC install for nights without internet.
- [ ] C30 Small hardening: per-mailbox OTP lockout window, `/readyz` room count, a staff-only tab-left counter.
