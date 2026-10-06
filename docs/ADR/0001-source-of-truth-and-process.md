# ADR-0001: Source of truth, contradiction policy and working process

Status: Accepted · Date: 2026-10-06

## Context
The product is specified by `docs/GDD.md` (production bible), `docs/QUESTION_QUALITY.md`
(audit rubric) and an execution brief. The brief referred to `docs/GDD.md`, but the repository
started empty, so the specification had to be imported. The GDD is a draft in places: it leaves
numbers undefined, contradicts itself in a few spots and names a few things twice.

## Decision
1. **Precedence** (highest first): running code + tests → GDD → ADRs/architecture docs → convenience.
   An ADR never silently overrides the GDD: every deviation is listed in the *Deviations from GDD*
   table in `docs/ARCHITECTURE.md` with the reason and the preserved intent.
2. `docs/GDD.md` and `docs/QUESTION_QUALITY.md` are verbatim copies of the handoff files and are
   not edited. Product decisions that complete or correct them live in ADRs.
3. **Contradictions** are resolved by choosing the safest architecture that preserves the intended
   player experience, recorded as an ADR, and covered by a test that pins the chosen behaviour.
4. **Language of artifacts:** documentation and code are English (matches the source documents);
   player-facing strings are localized (ADR-0016), Turkish first.
5. **Process:** work in milestones (see `docs/PLAN.md`). A milestone closes only when tests,
   typecheck, lint and build are green, `docs/STATUS.md` is updated and the work is pushed to the
   designated feature branch. No pull request is opened unless the owner asks for one.
6. **Done** means the definition in `docs/ENGINEERING_RULES.md` (UI + backend + DB + validation +
   errors + reconnect + security + tests + a real end-to-end path). Buttons, mocks and TODOs are
   never evidence of completion.
7. **Honesty rule:** anything that cannot be verified in the cloud sandbox (real store purchases,
   physical devices, smart-TV/console browsers, real cross-network latency, LLM-based fact checks)
   is reported as `EXTERNAL` in `docs/ACCEPTANCE.md` and `docs/FINAL_RELEASE_AUDIT.md`. It is never
   reported as passed.

## Consequences
- Future sessions start from `CLAUDE.md` → `docs/STATUS.md` and need no chat history.
- Commits never contain model identifiers; they carry only a generic assistant co-author trailer.

## Verification
`scripts/release-audit` fails CI if `docs/STATUS.md`, `docs/ACCEPTANCE.md` or the ADR index are
missing or inconsistent (M7).
