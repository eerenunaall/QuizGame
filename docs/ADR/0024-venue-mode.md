# ADR-0024: Venue mode (time-metered tables for cafés)

Status: Accepted · Date: 2026-10-19
Builds on: ADR-0005 (state machine), ADR-0006 (timer authority), ADR-0008 (protocol, allow-listed views),
ADR-0012 (accounts, sessions), ADR-0013 (entitlements, link intents), ADR-0018 (security posture).
First customer: Gusto Board Game Cafe. Owner and staff guide (Turkish): `docs/VENUE.md`.

## Context
Board-game cafés charge an entrance fee at the counter and let guests pick a game. When the guests pick
the quiz, a member of staff should be able to start a table on the café's TV for a paid amount of time,
let the game run itself, extend it when the guests pay more, and hand the winner a small reward (a free
drink). Nothing about this may change the base product, and the app must never become a payment
processor: no card data, no prices, no money moves through it. Staff collect money themselves; the
system only meters time.

## Decision

### 1. Off unless switched on
Everything sits behind the database feature flag `venue.sessions` (migration 0009, default **off**, not
public). With the flag off every venue route answers `404 FEATURE_DISABLED`, no room ever carries a meter,
and the base product behaves exactly as before. The flag is switched in the admin console (Bayraklar); a
deployment (e.g. the Gusto Render service) turns it on there, not by an environment variable.

### 2. Data (migration 0009)
`venues` (name, `settings` jsonb), `venue_staff` (venue, account, `OWNER|STAFF`), `venue_sessions` (venue,
room id + code, opened by, `purchased_seconds`, `started_at`, `paused_at`, `paused_total_seconds`,
`ended_at`, `state RUNNING|PAUSED|ENDED`), `venue_session_events` (append-only audit: OPEN, EXTEND, PAUSE,
RESUME, END with the staff account and the seconds), `venue_rewards` (venue, session, room, game id, the
winner's **display name only**, `code_hash`, `issued_at`, `expires_at`, `redeemed_at`, `redeemed_by`).
One open session per room is a partial unique index. Settings (validated by zod on every write, defaults
filled on read): `reward { enabled false, text '', minPlayers 3, maxPerDay 10, rematchCooldownMinutes 5 }`,
`defaultMinutes 60`, `extendSteps [15, 30, 60]`, `timezone 'Europe/Istanbul'`.

### 3. The meter (server-authoritative, injected clock)
`remaining = purchased − (elapsed − paused)`, with `elapsed = now − started_at` and `paused =
paused_total + (now − paused_at if paused)`. The arithmetic is pure (`packages/game-engine/src/venue.ts`,
unit-tested with an injected clock). Rules:
- **Extending after time ran out does not bill the gap.** The overrun is folded into the paused total
  before the minutes are added, so `+15 dk` always means fifteen minutes from now.
- **Pause** stops the clock; **resume** continues it. A meter with no time left cannot be paused.
- **End** closes the session for good (state ENDED); it is not reopened, a new table is opened instead.
- The room learns the meter through a new engine input `VENUE_METER { meter }` (logged like every input,
  so replay and crash recovery reproduce it). The room stores `{ state, endsAt, remainingMs }`: `endsAt`
  is absolute server time while RUNNING, `remainingMs` is frozen while PAUSED/ENDED.

### 4. What time-up does (never cut mid-answer)
A meter is **open** when it is RUNNING with time left. The engine checks it at two points only:
- `START_GAME`, `REMATCH` (and the deck hand-shake `BEGIN_GAME`) are refused with the new error
  **`VENUE_TIME_UP`** (no time left or ended) or **`VENUE_PAUSED`** (paused).
- When a round ends (`SCORE_UPDATE` → next), a closed meter sends the game to `RESULTS` instead of the next
  round. The question in progress always finishes: answers, reveal, power resolution and scores run as
  usual. Results of such a game are marked `cutShort` (server-side only).
Pause and End therefore behave like time-up for the game (finish the round, then results); this is
deliberate, otherwise a paused table would play for free.
An extension pushes a new meter at once (`VENUE_METER_CHANGED` to every screen): the TV's time-up screen
disappears and the leader can start again, no reload.

### 5. Tier through the existing entitlement path
While a meter is open the room is FULL through the engine's existing `ENTITLEMENT` input (reason `LINKED`
on open, `GRANTED` on an extension that reopens it). At time-up (a server timer at `endsAt`), on End and
on Pause it is not touched except: at time-up and End the room goes back to FREE (`EXPIRED`) **only when no
player account is linked to it** (a guest who owns the full game keeps it). There is no second tier path.

### 6. What reaches screens
The room view and `VENUE_METER_CHANGED` carry `venue { state, endsAt, remainingMs }`, allow-listed and in a
`.strict()` schema; nothing else of a venue (name, settings, staff, reward text, counts) is in any room
frame. The venue's name and logo on the TV come from the deployment's theme (`gusto`) and
`VITE_VENUE_NAME`, not from the server.

### 7. Staff surface
- Staff sign in with the existing email one-time code as an ordinary **WEB** session (`/staff`, mobile
  first, Turkish first). Being staff is a row in `venue_staff`, checked on every request; it is not a
  platform role and gives nothing in the admin console. Admin-console (ADMIN kind) sessions are refused on
  staff routes, like on purchase routes.
- Routes (all `auth: session`, rate-limited per account, CSRF-checked for cookies by the existing guard):
  `GET /v1/venue/me`; under `/v1/venues/:venueId`: `GET sessions`, `POST sessions` (open), `POST
  sessions/:sessionId/{extend,pause,resume,end}`, `POST rewards/redeem`, `GET|POST settings`, `GET staff`,
  `POST staff` (invite), `POST staff/:accountId/remove`. Non-members and unknown venues get the same `404`;
  a STAFF member on an OWNER action gets `403`. Every lookup of a session is scoped to the venue, so a forged
  session id of another venue is a `404`.
- **Opening a table** attaches a new session to a live room either by its 6-letter code or by the TV's
  existing unlock QR (`/unlock/<token>`; the staff account claims the link intent, which proves presence at
  the TV, ADR-0013). The room must be in WAITING, LOBBY or RESULTS and must not already have an open session.
- **Invite**: the owner adds an email address; the account is created unverified if it does not exist and
  becomes usable when that person signs in with a code sent to that address. No mail is sent by the invite.
- Admin console: create venues, assign the owner, per-day report (sessions, minutes sold, extensions, rewards
  issued/redeemed) with CSV export. No player data is in the report.

### 8. Rewards
At `RESULTS` (when the server persists `GAME_FINISHED`) one reward is issued to the single winner when all hold:
the venue's reward is enabled; the game was not `cutShort`; at least `minPlayers` ranked players are
**connected**; the session is not ENDED; fewer than `maxPerDay` rewards were issued today (the venue's
local day, serialized per venue with an advisory lock); and the game did not start within
`rematchCooldownMinutes` of the session's previous reward.
- **Ties: no reward.** Ranking already breaks ties by correct answers and time left (ADR-0007); players still
  equal on all three share rank 1, and then nobody gets the reward (join order is not a fair tie-break for
  a prize).
- The code is 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L), shown as `XXXX-XXXX`, ~40
  bits. Only an HMAC of it is stored. It expires at the end of the venue's local day.
- The code is sent **only to the winner's phone** (`VENUE_REWARD { code, text, expiresAt }`), and again if
  that phone reconnects while the room is still on those results. The TV gets `VENUE_REWARD_ISSUED
  { playerId }` (a banner "won a reward, the code is on their phone"). Other phones get nothing. Codes are not
  game state: they never enter the engine, its log or snapshots.
- **Redeem** is staff-only: `POST rewards/redeem { code }`, rate-limited per account (`venueRedeem`) and per
  venue, failures cost double. It is one conditional `UPDATE … WHERE redeemed_at IS NULL AND expires_at > now`
  (a row lock serialises concurrent attempts; exactly one wins) and a `CHECK` keeps `redeemed_at` and
  `redeemed_by` together. Answers: the reward text and winner name; `409 REWARD_ALREADY_REDEEMED`; `410
  REWARD_EXPIRED`; `404` for anything unknown. Every attempt is in the security log, every redemption in the
  session events.

### 9. Room lifetime
While a session is not ENDED, a venue room is not closed for lobby/results idleness or because every phone
dropped (phones sleep at a café table); the 6-hour lifetime cap still applies. If the room closes anyway (the
TV is switched off for longer than the abandon window), the session keeps metering until staff end it and
open a new table. Moving a session to another TV is not built.

### 10. Test clock
`VENUE_MINUTE_MS` (default 60000) scales one staff-facing minute for tests and demos; production refuses any
other value at boot.

## Consequences
- Single instance, like entitlements (ADR-0013 amendment): a session's room must live on the instance that
  serves the staff request; rooms on other instances are not reached.
- The mobile app ignores the new fields gracefully through the shared client (it renders no chip yet).
- Tests: engine `venue.test.ts`, `reducer.venue.test.ts`; integration `venue.test.ts`; ws `venue.test.ts`;
  red-team `venue.test.ts` (ATTACK 36); e2e `venue.spec.ts`.
