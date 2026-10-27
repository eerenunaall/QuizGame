# Engineering rules (distilled from the build brief)

## Non-negotiables
1. **Server authority.** Clients submit intents; the server validates and resolves. No client-owned
   score, timer, outcome, legality or progression. UI code never advances the game.
2. **Hidden information stays hidden.** Allow-list views, opaque option ids, outbound schema validation,
   payload-scanner test (ADR-0008).
3. **No faked core paths.** No mocked purchase, local multiplayer simulation, hard-coded API data or
   `TODO: connect later` in production paths. Test doubles stand in only for *remote* systems and speak
   the real wire contract.
4. **Never trust the client** for price, product, receipt, account, answer, score, time, role.
5. **Secrets never in git**; production boot fails closed on missing secrets.
6. **Question quality over volume** (`docs/QUESTION_QUALITY.md`); nothing is ACTIVE on one model's say-so.
7. **Every bug → regression test first.** Every red-team failure becomes a test.
8. **Simple over clever.** No framework without a concrete need; don't rewrite stable code for taste;
   optional/risky subsystems sit behind feature flags.

## Definition of done (a feature is DONE only if all hold)
UI exists · backend exists where required · DB model + constraints where required · validation ·
error handling with a user-visible recovery path · reconnect behaviour · security rules · tests ·
a real end-to-end path works. A button, a modal, a mocked API, a fake purchase, local-state
"multiplayer", a TODO or a green TypeScript build are **not** evidence.

## Milestone loop
IMPLEMENT → TEST → ATTACK → OBSERVE → FIX → TEST AGAIN. After each phase: tests, typecheck, lint,
build, inspect failures, fix, rerun, update `docs/STATUS.md`, commit, push. Do not stack unresolved
failures. At the end: full E2E → red team → performance → accessibility → release audit.

## Code style
- Match the surrounding code's comment density: comments explain *why* (invariants, security
  reasons, spec references like `GDD §8.2`), not what.
- Pure logic in `packages/*`; I/O at the edges; time and randomness are injected.
- Errors are typed codes; user-facing text lives only in `packages/i18n`.
- Never log secrets/tokens/answers; never return stack traces to clients.
- No model identifiers or tool attribution in code, comments, docs or commit messages beyond the
  standard assistant co-author trailer.

## Release gate (brief §34)
Do not call the product production-ready unless: acceptance criteria pass, no known critical
security issue, no server-authority bypass, purchase verification works, reconnect works, blind
answers are private, the question pipeline works, core modes work, browser compatibility is
documented, mobile fallback works, monitoring works, backup strategy and release checklist exist.
`docs/FINAL_RELEASE_AUDIT.md` lists PASS/FAIL (+ reason and blocking dependency) per criterion.
