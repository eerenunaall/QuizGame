# ADR-0009: Sessions, reconnect tokens, nicknames and the host model

Status: Accepted · Date: 2026-10-06

## Context
GDD §17/§18/§30 define a `hostSessionId`, reconnect tokens, "host migration" and "deterministic" new
hosts, but a TV remote is a poor input device and the TV is a renderer. They never say who can press
START, how a reused/stolen token is handled, or how nicknames are protected. Red-Team ATTACK 8
("steal reconnect token → minimal blast radius, secure invalidation") needs a concrete design.

## Decision
### Identities
- **Room code**: 6 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 symbols, no 0/O/1/I/L), generated
  with `crypto.randomInt`, unique among open rooms (≈ 8.9·10⁸ codes). Lookup is rate limited per IP
  with exponential back-off for failures; unknown/closed rooms return an identical generic error.
- **roomId**: random UUID, appears in messages but grants nothing.
- **Session** = one device in one room: `sessionId` (UUID) + `reconnectToken` (256-bit random,
  returned once, stored only as SHA-256 hash). Roles: `DISPLAY`, `PLAYER`.
- A player has a stable `playerId` inside the room, bound to exactly one live session.

### Token lifecycle (rotation + reuse detection)
- Every successful `RECONNECT` **rotates** the token: the response carries the new token; the old
  hash is kept as `prev_token_hash` for a 10 s grace window (response lost in transit).
- Presenting the previous token inside the window re-rotates (idempotent for the legitimate client).
- Presenting a token that was rotated out **after** the window, or any unknown token for a known
  session id, is treated as theft/reuse: the session is **revoked**, the live connection receives
  `SESSION_REVOKED`, a `security_events` row is written, and further attempts for that `sessionId`
  are rejected with a generic error. Blast radius: one player slot in one room; no account, no
  payment and no other room is affected.
- The legitimate owner of a revoked slot asks the host to **remove the ghost** (`KICK_PLAYER`) and
  rejoins with the nickname. (Nicknames are owned by their session until kicked/left, so nobody can
  squat a disconnected player's name.)
- Tokens expire with the room (max lifetime 6 h) and on `LEAVE_ROOM`/kick.

### Duplicate device / tabs
One live connection per session: a new authenticated connection **supersedes** the old one
(`SESSION_SUPERSEDED` sent to it). A second *player slot* from the same device id in the same room
is refused (`ALREADY_JOINED`). A person using two different devices is not preventable for anonymous
players and is treated as a host-moderation matter (kick).

### Nicknames
NFKC-normalized, trimmed, 2–16 characters, letters/digits/space/`_ - .`, plus at most two emoji;
control, format, bidi-override and zero-width characters are rejected; mixed-script (Latin+Cyrillic/
Greek) is rejected; uniqueness is checked on a *skeleton* (Turkish-aware case fold + diacritic fold +
confusable map) per room; profanity filter (ADR-0018). Avatars/colours come from fixed server-side sets.

### Host model (display + leader)
- `hostSessionId` = the **display** session created with the room (it may press START with a remote
  or keyboard when the display is a desktop). `leaderSessionId` = the **first player to join**
  (the person holding a phone). Host commands are accepted only from these two sessions; the reducer
  makes them idempotent by phase, so concurrent commands cannot conflict.
- **Leader migration**: if the leader is disconnected longer than `leaderGraceMs` (20 s) the role
  moves deterministically to the connected player with the lowest `joinIndex` (tie → lowest `playerId`).
  The returning player does not auto-reclaim; the leader may `TRANSFER_LEADER` explicitly.
- **Display recovery**: refresh/reload resumes by token. A display that lost its storage uses
  *display pairing*: the new `/tv?room=CODE` shows a 4-digit pairing code; the leader enters it on the
  phone (`PAIR_DISPLAY`), which issues a fresh display session and revokes the old one.
- **Ownership vs control**: the entitlement owner is `hostAccountId` (ADR-0013). Host *control* is
  session-based and independent. Migrating control never transfers the entitlement.
- Host cannot set score, reveal answers, edit timers, inject questions or alter entitlements — no such
  command exists in the protocol (GDD §30).

## Verification
Token rotation/grace/reuse tests, nickname skeleton property tests, leader-migration determinism
test, forged-host-command red-team test, display pairing integration test.
