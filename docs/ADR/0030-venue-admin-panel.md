# ADR-0030: Venue admin panel (entrance price, look, logos, answers view)

Status: Accepted · Date: 2026-11-06
Builds on: ADR-0008 (allow-listed views), ADR-0012 (accounts), ADR-0018 (security posture), ADR-0024
(venue mode), ADR-0025 (question sets), ADR-0026 (teams), ADR-0028 (TV pairing, studio).
Amends ADR-0024 §6: a room at a café table now also carries the venue's own look (see §3). Owner guide
(Turkish): `docs/VENUE.md`.

## Context
Owners and staff are not technical and work on a phone. They need one fast panel to see what guests will
be asked (with answers), set the winner's prize, show the entrance price on the TV, and put their own
logos on TV and phones. The product is white-label: the next café must not see another café's name,
colours or images.

## Decision

### 1. One panel, two addresses, one tab list
`/staff` and the alias `/mekan` serve the same page (plus a web app manifest so "Ana ekrana ekle" works).
The page is defined by one `TABS` array (`id`, i18n label key, icon, `role`); a new section is one line.
STAFF: Masalar, Yeni masa, Ödül doğrula, TV'ler and the question counts of Sorular (ADR-0025). OWNER adds:
Ödül, Giriş ücreti, Görünüm, Oyun, the answers view inside Sorular, Soru Stüdyosu, Personel (and Quiz Gecesi,
ADR-0029, which only added a line to `TABS`). The tab is part of the page state and never reset by a late timer (timers are
cleared on unmount). Authorisation stays where it was: the server checks every call (a hidden tab is
convenience, not security).

### 2. Settings (venue `settings` jsonb, validated in full on every write)
- `entrance { enabled, text ≤ 40, note ≤ 80 }`: a **display string**. The system never handles money, there
  is no amount field and nothing is computed from it. Text goes through the same screening as team names
  (normalisation, no links/profanity/hidden characters). Enabled needs a non-empty text.
- `look { theme, accent, logo, teamLogos[≤8] }`: `theme` is one of the shared theme ids, `accent` a key of a
  **closed** palette (each entry unit-tested for contrast against every theme background and for dark label
  text on it); the owner never types a colour. `logo`/`teamLogos` are asset hashes that must exist in the
  venue's own asset table (otherwise the write is refused).
- Existing `reward`, `play.teamNames` keep their meaning; the panel is only a better editor for them.

### 3. What reaches screens (amends ADR-0024 §6)
Only for a room with an **open table** the `venue` block of the room view and `VENUE_METER_CHANGED` may
also carry, all optional, allow-listed and `.strict()`:
`entrance { text, note? }`, `look { name, theme, accent? }`, `branding { logo?, teams? }` where branding
values are server-built same-origin paths `/v1/venue-assets/<venueId>/<hash>`. Nothing else of a venue
(settings, reward text, staff) is added. A settings write while a table is open re-pushes the meter, so
the TV and phones change live. Rooms without a table carry none of it. The venue's own name/theme/logo
replace the deployment fallbacks on that table; **no other venue's** data and no hard-coded brand string is
ever used (the bundled Gusto logo only appears for a deployment that configures it, never as a fallback
for a venue with its own look).

### 4. Logos (security-sensitive)
- Storage: PostgreSQL `venue_assets` (migration 0015): `bytea` ≤ 300 KB, per venue, max 12 per venue,
  `sha256`, content type, real width/height, `created_by`; `ON DELETE CASCADE` with the venue. Unique per
  `(venue_id, sha256)`: re-upload of the same bytes is idempotent.
- Upload: OWNER session, `POST /v1/venues/:venueId/assets` with base64 JSON `{ kind: 'LOGO'|'TEAM', data }`
  (no filename, no client content type), CSRF header, per-account and per-venue rate limits.
- Accepted: **PNG, WebP (lossy/lossless, still), JPEG** only, decided by magic bytes, never by name or
  claimed type, after parsing the **whole container**: PNG chunk whitelist (IHDR, PLTE, tRNS, IDAT, IEND,
  sRGB, gAMA, pHYs) with CRC check and no bytes after IEND; JPEG segments limited to JFIF/Adobe/quant/
  Huffman/SOF/SOS/DRI with no EXIF/COM/APPn payload other than JFIF/Adobe and nothing after EOI; WebP RIFF
  with VP8/VP8L/VP8X without animation, ICC or EXIF flags and an exact RIFF length. Real dimensions come from
  the header: ≤ 1.6 Mpx; team marks square-ish (ratio ≤ 1.25) 64–1024 px; venue logo ≤ 1600 × 600 and ≥ 64.
  Rejected: SVG, GIF, APNG, HTML/script renamed, polyglots (trailing data), truncated or mismatching files.
- Serving: `GET /v1/venue-assets/:venueId/:hash` (public by hash: TVs and phones are anonymous; the hash is a
  256-bit content address, the venue id is part of the key, a wrong pair is the same `404`). Headers: forced
  `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`,
  `Content-Disposition: inline; filename="logo"`, `Cache-Control: public, max-age=31536000, immutable`,
  `Cross-Origin-Resource-Policy: same-origin`; per-IP rate limit.
- **Residual risk**: bytes are validated, not re-encoded (no image library in the server). A crafted but
  structurally valid image could still exploit a browser decoder bug; mitigated by the strict container
  rules, size limits, same-origin only, CSP and `nosniff`. Re-encoding is a possible follow-up.
- A refusal is `400 IMAGE_REJECTED` with `params.reason` FORMAT, SIZE or DIMENSIONS (and a security-log row);
  the 13th image is `409 LIMIT_REACHED` (a per-venue advisory lock keeps the count race-free); a body over the
  base64 size of 300 KB is cut off by the framework (413) before it is read.
- Housekeeping: a look save deletes images the venue no longer refers to once they are older than 5 minutes
  (so "Geri al" still works).
- Admin console: Venues page lists a venue's images and can remove one (audited). Removing an image drops
  it from the venue's `look` too.

### 5. Answers view: who sees answers
The OWNER tab "Sorular" shows (a) the venue's own questions with answers and (b) a read-only browser of the
**global bank** (search, category filter, correct option marked, explanation, status, difficulty) so the
café can check what guests will be asked. OWNER only: STAFF `403`, players/TV/admin-console sessions
`401/403/404`. CSRF header, per-account rate limit, every bank read written to the security log with the
account and venue. Other venues' private questions are never returned (global pool, status ACTIVE only, or the caller's own venue questions; the scope is fixed in the query, never
taken from a parameter). This is a deliberate, narrow exception to "answers are not sent before reveal": the
data goes to an authenticated owner's panel, never into a room.

### 6. Payments off
`GET /v1/config` also returns `paymentsEnabled` (the `PAYMENTS_ENABLED` flag). With it off the TV hides
"Kilidi aç" and the account-attach button of `/unlock`; with it on nothing changes.

## Consequences
- White-label is a data property: a second café differs only by its settings and assets.
- Tests: pure image parser (hostile corpus), integration (settings, assets, isolation, CSRF, rate limits,
  bank), ws (room view carries entrance/branding only at a table, live), red-team 47–59, jsdom (tabs,
  forms, two-venue leak test), one Playwright flow.
