# ADR-0025: Venue question sets (a café uploads its own questions)

Status: Accepted · Date: 2026-10-20
Builds on: ADR-0008 (allow-listed views, payload scanner), ADR-0011 (deck building), ADR-0012 (accounts),
ADR-0014 (import and audit), ADR-0018 (security posture), ADR-0024 (venue mode).
Owner and staff guide (Turkish): `docs/VENUE.md`. File format and AI prompt: `docs/venue-question-template.md`.

## Context
A café wants quizzes about its own world (its board games, its neighbourhood, house jokes) without a
deploy and without waiting for the central bank. The owner often has an AI assistant prepare the file.
Raw AI output must never reach players unchecked (ADR-0014), a venue's content must never leak into the
public pool or to another venue, and a bored regular crowd must not see the same question every week.

## Decision

### 1. Ownership and scope
- Migration 0011 adds `questions.owner_venue_id` (nullable, FK to `venues`, cascade) and the pool value
  `VENUE`. A CHECK ties them: `(pool = 'VENUE') = (owner_venue_id IS NOT NULL)`. Public and global rows
  have `owner_venue_id IS NULL`. The `VENUE` pool cannot be written through the import contract (the
  schema's `POOLS` stays `EVERGREEN|CURRENT`); only the venue importer sets it.
- A venue question is served **only** by the deck builder, **only** for a room that has an open (not ENDED)
  metered session of that venue, and **only** when the venue's `questions.source` setting allows it.
  Every public read of the bank (category catalog, deck builder without a venue, admin curation lists
  default views) filters `owner_venue_id IS NULL`. There is no code path that selects venue rows by
  anything but `owner_venue_id = <the room's venue>`.
- Uniqueness is scoped: the lexical-fingerprint index is split into one for global rows and one for
  each venue's live (non-RETIRED) rows, so two venues can hold the same text and neither learns of the
  other. `external_id` is not stored for venue rows (the global unique index would be a side channel).
- Venue categories: a category name in the file that is not a global category id creates a
  venue-scoped category (`categories.owner_venue_id`, id `v<8 hex of venue id>-<slug>`), at most **20 per
  venue**. Venue categories are never in the public catalog; they are drawn when the table plays "all
  categories" (the default) and, in MIXED/VENUE_ONLY, are part of the venue's share. A file may also use
  an existing global category id; those rows are venue-owned and still only served at that venue.

### 2. Who may do what
**Only the venue OWNER imports, retires a set, exports it or changes the question source.** Decision
rationale: content is the venue's voice and liability, a waiter must not be able to publish a joke to the TV
on a Friday night, and the owner is the account the platform can hold to the rules (ADR-0012). STAFF can
open the "Sorular" tab and see the list of uploads and the counts (per category, active, retired), nothing
else; every other route answers `403` (a non-member and an unknown venue get the same `404`, ADR-0024 §7).
Admins (console) can list every venue's sets and retire a set or a single question. Admin-console sessions
are refused on staff routes, as before.

### 3. The pipeline (dry-run, then import)
`POST questions/dry-run` and `POST questions/import` run the **same** analysis on the same bytes; the
import re-analyses (it never trusts the earlier report):
1. **Bytes -> text.** Limits: 2 MB, 2000 rows, 4000 characters per cell. Binary (NUL bytes, `PK`/zip,
   PDF, images, gzip), invalid UTF-8 that is not plausibly Windows-1254 and files that are mostly
   replacement characters are refused with a Turkish reason ("save as CSV UTF-8"). A BOM is dropped.
   Windows-1254 (Turkish Excel "CSV") is decoded when UTF-8 fails and flagged as a warning.
2. **Format** by extension, then content: `.jsonl`/first byte `{` is JSONL, anything else CSV. CSV
   delimiter (`,` `;` or tab) is detected from the header line (Turkish Excel writes `;`). Turkish header
   names (`soru`, `kategori`, `zorluk`, `doğru`, `açıklama`, `kaynak`, `şık A`...) are aliases of the
   canonical columns; a cell that starts with `'` followed by `= + - @` loses that apostrophe (our own
   export protects such cells, so an export can be edited and re-uploaded).
3. **Row validation** with the existing `QuestionImportSchema` (`authorType` defaults to `AI_ASSISTED`;
   `DEV_SEED` is refused). All text goes through `cleanText` (NFC, zero-width and bidi controls removed,
   control characters dropped) and the player-facing sanitiser rules; difficulty also accepts
   `kolay|orta|zor|uzman`. Every problem becomes `{line, field, code, params}`; the web page turns it into a
   Turkish (or English) sentence that says what is wrong and how to fix it (`packages/i18n`,
   `venue.issue.*`, `venue.fix.*`; a unit test proves every emittable code has both).
4. **Heuristic audit** (the existing 40-odd checks, `sourceRequired = false` for venue content) plus the
   batch checks, and **duplicate detection** (lexical fingerprint, MinHash, vector proxy) against the
   global bank **and this venue's own live questions**, and inside the file.
5. **Verdict per row** from the heuristic status: `PASS` -> imported and ACTIVE; `REVIEW` -> listed with
   the reasons, **not stored** (staff fix the file and upload again; the passing rows are by then
   duplicates and are skipped); `REJECT` -> never stored. Invalid and duplicate rows are listed too.
   A near-duplicate of a *global* question is a duplicate too: a venue gains nothing by copying the bank.
6. **Idempotency.** The upload is identified by the SHA-256 of its bytes: a file whose hash matches a live
   upload of the venue is answered with that earlier upload (`alreadyImported`), nothing changes. Different
   bytes with the same questions are caught by the fingerprints.
7. **Caps.** 5000 non-retired questions per venue (the import refuses the rows beyond it with a clear
   message), 20 venue categories, 2000 rows per file.

### 4. How a venue question becomes ACTIVE without a fact check
The DB guard (`questions_guard`, migration 0004) demands an ARBITER PASS with a passing fact-check
dimension. Nobody can fact-check a café's house questions, and pretending would be worse than saying so.
Migration 0011 amends the guard for **owner-attested** rows only: a row with `owner_venue_id` may be ACTIVE
when the latest `HEURISTIC` audit for its current revision is `PASS` (and the 2-6 options / exactly one
correct invariant holds). The audit row records `detail.ownerAttested = true`, the uploader and the upload
id. Because these rows are served only at that venue, the owner is the publisher and answers for the facts;
the central bank's rule (nothing ACTIVE on a model's say-so) is untouched for every global row. Editing
frozen content still needs a move to REVIEW. The importer never uses a model; there is no network call.

### 5. Retiring, reports, moderation
- "Bu yüklemeyi kaldır" soft-deletes: every question of the upload goes ACTIVE -> RETIRED through the
  lifecycle (status log written by trigger), the upload row becomes `RETIRED`. Rows are never deleted.
  The same upload bytes can then be uploaded again.
- Players report a venue question with the existing `REPORT_QUESTION` (the deck marks it `BANK`); it lands in
  `question_reports` and the admin queue like any other. The owner sees the open reports of the venue's own
  questions (`GET questions/reports`: reason, question text, no reporter) and can dismiss or retire the
  question. Thresholds (ADR-0014) pull a reported venue question to REVIEW, i.e. out of play, automatically.
- Admin console: per venue the sets, counts, status; retire an upload or one question; both are written to
  `admin_audit`. A venue's content can be switched off without touching the venue by retiring its sets.

### 6. Audit log
`venue_question_uploads` (venue, uploader, time, file name, file hash, format, bytes, counts, state) is the
journal of what came in; `venue_content_events` is append-only (IMPORT, RETIRE_UPLOAD, RETIRE_QUESTION,
ADMIN_RETIRE with actor and counts). Refusals (non-owner attempt, rate limit, hostile file) are in the
security log (`VENUE_CONTENT_FORBIDDEN`, `VENUE_CONTENT_REJECTED`).

### 7. Rate limits
Token buckets: per account `venueContent` (6 per 10 minutes, dry-run and import share it), per venue
`venueContentVenue` (20 per hour) and the generic per-account `venue` bucket for the read routes. The body
limit of the two upload routes is 3.5 MB (2 MB of file as base64). Everything else keeps the 16 KB default.

### 8. Question source setting
`settings.questions = { source: 'MIXED' | 'VENUE_ONLY' | 'GLOBAL_ONLY', venueSharePercent: 30 }` (owner
only, validated, default MIXED/30). The deck builder draws, per difficulty bucket:
- `GLOBAL_ONLY`: no venue rows.
- `VENUE_ONLY`: venue rows first; if the venue pool cannot fill the deck the missing part comes from the
  global bank (**a game is never blocked**; the ADR trades purity for availability and the owner is told on
  the Sorular tab how many questions each category has).
- `MIXED`: about `venueSharePercent` of each bucket from the venue pool, the rest from the global bank; a
  side that lacks questions is topped up from the other.
Room tier is unaffected (a metered table is FULL, ADR-0024); a non-venue room never sees venue rows.

### 9. Freshness (anti-boredom)
`venue_question_history (venue_id, question_id, played_at)` (primary key venue + question) is upserted when
a round of a game in a venue room is settled (same transaction as the bank counters, ADR-0014: never
counted twice). For a room attached to a venue, the deck builder ranks candidates with the pure function
`rankFresh` (`apps/realtime/src/rooms/freshness.ts`): per category, the **N most recently played distinct
questions** (config `VENUE_FRESH_WINDOW`, default **300**) count as *recent*; every non-recent candidate is
preferred (random order from an injected `random`), then recent ones, least recently played first. A
small pool therefore degrades gracefully into "oldest-played first" and the builder never fails because
of history. This applies to the global bank in venue rooms too. Non-venue rooms keep the existing
"least recently used globally, then random" order.
Property tested: over many simulated games in a 100-question category no question repeats before all 100
were played once.

### 10. Display safety
Question text is plain text everywhere (React escaping; TV and phone render text nodes), the web CSP stays
`script-src 'self'` with no inline script, and `sanitizeUserText`/`cleanText` strip invisible and bidi
characters on the way in. A test plays a script-looking question and asserts it appears as text and no
script executes. Correct answers of venue questions travel in the same allow-listed room views as global
ones: not before the reveal (ADR-0008); the payload-scanner tests run with a venue deck.

### 11. Export
`GET questions/export` (owner) returns the venue's non-retired questions as CSV in the import format (so it
can be edited and re-uploaded); every cell goes through `safeCell` (apostrophe before `= + - @`, tab, CR).

## Consequences
- One more write path creates ACTIVE questions without a model fact-check; it is confined by schema
  (`owner_venue_id`), by the guard, and by serving rules. Reports and the admin retire switch are the
  safety net.
- `scripts/question retire-dev`/`retireOutsidePrefix` (the "switch the served bank" job) must ignore
  `owner_venue_id IS NOT NULL` rows (it keys on `external_id`, which venue rows do not have).
- Venue categories are not selectable in the public lobby picker (it is anonymous and global); they play
  under "all categories". A per-room catalog is future work.
- Single database, single instance for the in-memory pieces, like ADR-0024.
- Tests: unit `venue-file.test.ts`, `venue-import` (bank), `freshness.test.ts`, i18n coverage; integration
  `venue-questions.test.ts`; websocket `venue-questions.test.ts`; red-team `venue-questions.test.ts`
  (ATTACK 37); web `venue-questions.test.tsx`; e2e `venue-questions.spec.ts`.
