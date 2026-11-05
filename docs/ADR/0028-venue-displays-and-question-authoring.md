# ADR-0028: Venue displays (licensed TVs) and question authoring (Soru Stüdyosu)

Status: Accepted · Date: 2026-10-27
Builds on: ADR-0008 (allow-listed views), ADR-0009 (session tokens), ADR-0012 (accounts), ADR-0013 (link
intents), ADR-0014 (import, audit, `authorType`), ADR-0018 (security posture), ADR-0024 (venue mode),
ADR-0025 (venue question sets). Owner guide (Turkish): `docs/VENUE.md` ("TV ekleme", "Soru Stüdyosu").

## Context
QuizNight is sold to cafés as software per venue. On a café's deployment a guest must only ever see the
phone join screen; the TV must not be something anybody can open from the public site, and the café's
own panel "sends" the game to its TVs. Each paired TV is a licence seat. Separately, owners want to write
questions by hand and to turn a document (PDF, Word, text) into questions without learning a file format.

## Decision

### 1. VENUE_LOCK is a deployment setting, not a database flag
`VENUE_LOCK=1` (environment, default `0`). A licence boundary must fail closed: database flags read
"off" when the database is unreadable (ADR-0018), which here would unlock the TV. With the lock **off**
nothing changes (the public browser game, `/tv`, the mobile app). With the lock **on**:
- `POST /v1/rooms` needs a valid **venue display credential** (below); without one it answers `403
  FORBIDDEN` and records `DISPLAY_UNPAIRED_CREATE`. This is server enforcement, not a hidden button. The
  mobile app and any script cannot create rooms on such a deployment.
- `/tv` shows the pairing screen instead of the title menu until the browser is paired.
- Phones join rooms by code/QR exactly as before (`JOIN_ROOM`, `/join/CODE`): guests only see the phone.
The page learns the mode from `POST /v1/display/poll` (`lock: true|false`). The Gusto blueprint
(`render.production.yaml`) sets it on.

### 2. Pairing (TV ⇄ panel)
1. The TV (`/tv`, same path as before so bookmarks and TV launchers keep working) calls `POST
   /v1/display/pairing`. The server creates a pairing: an 8-character code from
   `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L), shown `XXXX-XXXX` with a QR of
   `/staff?pair=XXXXXXXX`, valid **5 minutes**, single use. Only HMACs of the code and of a 256-bit
   *pairing secret* are stored; the secret goes to that browser alone as an `HttpOnly; SameSite=Strict`
   cookie, so only the screen that showed the code can collect the result. Starting a pairing is limited
   per address (`displayPairStart`, 10 per 10 minutes) and live pairings are capped (500 per instance).
2. The **OWNER** signs in on `/staff`, opens "TV'ler", taps "TV ekle", types or scans the code and names
   the screen ("Salon TV 1"). `POST /v1/venues/:venueId/displays/pair { code, name }`. Codes are
   case-insensitive (upper-cased, dashes and spaces ignored). Claims are limited per account
   (`displayPair`, 10 per 10 minutes, a miss costs double) and per venue (30 per hour). Unknown, used and
   expired codes answer the same `404`.
3. The TV's next poll presents the pairing secret; the server answers with the **display credential**
   as an `HttpOnly; SameSite=Strict; Path=/` cookie, `__Host-qp_display` in production (`qp_display`
   in development). The credential is 256 random bits, only its HMAC is stored (`venue_displays`).

**Entropy.** 31^8 ≈ 8.5·10^11 (39.6 bits). An attacker must be a signed-in owner of some venue; with
10 claims per 10 minutes (misses cost double, so 5) and at most 500 live codes, one guess wins with
p ≤ 500 / 8.5·10^11 ≈ 5.9·10^-10; a full year at the limit (≈ 2.6·10^5 guesses) stays below 1.6·10^-4,
and in practice a handful of codes are live at a time. A code lives 5 minutes and dies on first use.

**Who may pair: OWNER only.** A pairing installs a long-lived credential and consumes a paid seat; a
waiter must not be able to do that (nor to remove a TV). STAFF see the list and may "Bu TV'de oyun aç",
which is the same power they already have when opening a table by code (ADR-0024 §7).

### 3. The display credential
- **Rotated on use**: when the current token is older than one hour, a poll issues a *pending* token
  (new cookie) while the current one stays valid. The first request that presents the pending token
  promotes it; the old one then works for 30 more seconds (requests already in flight) and afterwards is
  **reuse**: the display is revoked and `DISPLAY_TOKEN_REUSE` recorded (a copy of the cookie exists).
  A lost response is harmless: the TV still holds the current token and gets a fresh pending one.
- **Revocable** at once by the owner ("Kaldır") or an administrator. Revoking closes the rooms that
  display created (reason ADMIN); the TV's next poll (every 3 s) finds itself unpaired and shows the
  pairing screen. An open table on such a room keeps metering until staff end it (ADR-0024 §9).
- **Expiry**: a credential unused for 180 days is dead; the cookie's Max-Age is 400 days (browser cap).
- **Seats**: `venues.display_seats` (default **3**, 0–50, ADMIN-editable in the console = the licence
  knob). Pairing counts active displays under a row lock on the venue, so concurrent claims cannot
  exceed the seats (`409 LIMIT_REACHED`).
- Last seen is kept in memory (online = polled in the last 15 s) and written to the row at most once a
  minute. Scoped to the venue in every query: a display id of another venue is a `404`.

### 4. "Bu TV'de oyun aç" (open a game on a paired TV)
`POST /v1/venues/:venueId/displays/:displayId/open { minutes? }` (OWNER or STAFF). The TV must be online
(else `409 INVALID_STATE {reason: offline}`). If the room this TV last created is live, attachable
(WAITING/LOBBY/RESULTS) and has no open table, the table is opened on it; if it is in a game, `409
GAME_IN_PROGRESS`. Otherwise the **server** creates a new room for that display and hands the display
session to the TV through its next poll, once (it is never stored; it expires after 2 minutes if the
TV does not collect it). With `minutes` a metered table (ADR-0024) is opened on the room at once.
The TV itself may also start a room while paired (its own "Oyun aç" button), as today.

### 5. Admin console
Per venue: the paired displays (name, paired at, last seen, state), revoke, and the seat count. All
`admin_audit`ed. `GET /v1/admin/venues/:id/displays` (venuesRead), `POST …/displays/:displayId/revoke`
and `POST …/seats` (venuesWrite).

### 6. Question authoring (Soru Stüdyosu), OWNER only
Same rationale as ADR-0025 §2: content is the venue's voice and liability.
- **Manual**: a form (category from the venue's own and the global ones, question, 4 options, the correct
  one, difficulty, "Biliyor muydun?" explanation, optional source URL). The question is turned into one
  JSONL row and runs through the **same** pipeline as a file upload (`importVenueUpload`: validation,
  player-text gate, heuristics with `sourceRequired=false`, duplicate checks against the bank and the
  venue). `authorType: HUMAN`. PASS → ACTIVE in the venue pool; REVIEW/REJECT/INVALID/DUPLICATE are not
  stored and the reasons are shown in Turkish (the existing `venue.issue.*` texts). "Kontrol et" is a
  dry run of the same thing. Each save is one upload (`origin MANUAL`), so "Bu yüklemeyi kaldır" works.
- **Files**: PDF, DOCX, TXT and MD are read server-side; CSV and JSONL keep the existing import path.
  Extraction runs in a **worker thread** (`venue/extract-worker.mjs`) with a 64 MB heap cap and a 15 s
  wall-clock budget after which the worker is terminated: a hostile file cannot block the event loop.
  Limits: 10 MB, 50 pages, 200 000 characters. PDF uses `unpdf` (a maintained, dependency-free build of
  Mozilla's pdf.js) with eval, scripting, font loading and fetching off; the bytes are passed in memory,
  so nothing is fetched and embedded JavaScript is never run. A PDF with an `/Encrypt` dictionary or one
  that asks for a password is refused ("Bu PDF şifreli"). DOCX is read by a 100-line zip reader in the
  worker (central directory, stored/deflate only, inflate capped at 20 MB against zip bombs) that takes
  the text runs of `word/document.xml`; no external relationship is followed. We chose that over
  `mammoth`, which brings a zip library, an XML parser and HTML conversion we do not need.
- **Generation** (needs `AUTHORING_API_KEY` and `AUTHORING_MODEL`; optional `AUTHORING_API_BASE`,
  `AUTHORING_TIMEOUT_MS` default 90 s, `AUTHORING_DAILY_RUNS` default 10). Off unless configured; the page
  says why. The model name comes only from the environment. **What the model sees**: a fixed system
  prompt, the owner's requested count (≤ 30), the language (`tr`) and the document text (at most 60 000
  characters, page-marked) inside a JSON value marked as untrusted data. Nothing about the venue, the
  account, other questions or the configuration is sent. The reply is parsed against a strict schema
  (`questions[]` of question, exactly 4 options, `correctIndex`, explanation, `sourceQuote`, `page`);
  a question whose quote does not occur in the document, that is not Turkish, that fails the schema or
  the player-text gate is dropped; anything beyond 30 is dropped. Prompt injection in the document can
  at worst produce questions about the injected text, which the owner then sees in review.
- **Review gate**: generated questions are **drafts** (`venue_question_drafts`, `authorType AI_DRAFT`,
  the source file's SHA-256 and name recorded, 7-day expiry). The owner sees cards (question, options
  with the correct one marked, explanation, the source quote and page), can edit, delete, approve one or
  "Hepsini onayla". Only approved drafts enter the pipeline above (`origin AI`); PASS → ACTIVE in the
  venue pool, anything else stays a draft with the reasons. Drafts never touch the global bank.
- **Cost and abuse**: per account `venueAuthoring` (3 per 10 minutes), per venue `AUTHORING_DAILY_RUNS`
  runs per rolling 24 h (counted in `venue_authoring_runs`, which also records tokens), one attempt with
  the timeout, a circuit breaker (3 failures → 30 s open) like the decoy adapter. Neither the document
  nor the reply is logged. Upload body limit 14 MB (10 MB as base64).

## Consequences
- A café deployment can no longer be used as a free public TV game; that is the point.
- Rooms opened for a display and the "last room" link are in memory: single instance (ADR-0024).
- New tables: `venue_displays`, `venue_display_pairings` (migration 0013), `venue_question_drafts`,
  `venue_authoring_runs`, `venue_question_uploads.origin/source_file_hash` (migration 0014).
- Tests: unit `display-codes.test.ts`, `extract.test.ts`, `authoring.test.ts` (parser, injection);
  integration `venue-displays.test.ts`, `venue-authoring.test.ts`; red-team `venue-displays.test.ts`
  (ATTACK 60–64), `venue-authoring.test.ts` (ATTACK 65–67); web `display-pairing.test.tsx`,
  `question-studio.test.tsx`; e2e `venue-displays.spec.ts`.
