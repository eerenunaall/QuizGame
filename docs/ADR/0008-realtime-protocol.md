# ADR-0008: Realtime protocol, sequencing, idempotency and information hiding

Status: Accepted · Date: 2026-10-06

## Context
GDD §16 lists message names and an envelope but not who owns which counter, how replays are
rejected, how the public view is separated from private data, or naming conflicts
(`ENTITLEMENT_GRANTED` in §6.7 vs `ENTITLEMENT_CHANGED` in §16 and the brief).

## Decision
### Envelope (every message, both directions)
`{ type, protocolVersion, messageId, roomId, sessionId, sequence, timestamp, payload }`
- `protocolVersion`: integer (currently 1). The server supports a range; an unsupported version gets
  `ERROR{UNSUPPORTED_PROTOCOL, min, max}` so apps can prompt an update.
- Client → server: `messageId` is a UUID idempotency key; `sequence` is a per-session counter that
  must be **strictly greater** than the last processed one (gaps allowed). `sequence ≤ last` →
  `STALE_SEQUENCE`; a known `messageId` returns the cached result without re-executing.
  This kills replayed captures without needing per-message signatures.
- Server → client: `sequence` is a per-connection counter (gap ⇒ client sends `REQUEST_STATE`);
  state-bearing messages additionally carry `stateVersion` (the room's monotonic version) so stale
  snapshots arriving after newer events are ignored. `timestamp` is server time (ms).
- Hard limits: 16 KiB client message, token-bucket rate limit per connection, separate tight bucket
  for `SUBMIT_ANSWER`/`SABOTAGE`; flood ⇒ close 1008 and IP back-off.
- Browser connections must send an allow-listed `Origin`; connections without `Origin` (native apps,
  tools) are allowed because authorization is by session tokens, not by origin.
- **Tokens never travel in URLs.** The first message of a connection must be `JOIN_ROOM` or
  `RECONNECT`; anything else closes the socket after 5 s.

### Message catalogue
Client → server: `JOIN_ROOM RECONNECT SET_NICKNAME READY SUBMIT_ANSWER USE_POWER SET_RISK SABOTAGE
LEAVE_ROOM REQUEST_STATE PING SET_PREFERENCES SUBMIT_STATEMENT REPORT` and host commands
`START_GAME SET_SETTINGS KICK_PLAYER REMATCH BACK_TO_LOBBY END_ROOM TRANSFER_LEADER REQUEST_UNLOCK_LINK`.
Server → display/phones: as GDD §16.1/§16.2 plus `PONG SESSION_REVOKED SESSION_SUPERSEDED
UNLOCK_LINK PHASE_CHANGED`.
**Naming resolution:** the single entitlement event is `ENTITLEMENT_CHANGED{tier, reason}`; it covers
grant, restore, refund and revocation. `ENTITLEMENT_GRANTED` is not used.
Human text never travels in the protocol: errors carry a `code` (+ parameters); clients localize.

### Information hiding (structural, not by deletion)
- Engine state has a private part (deck with correct answers, PRNG, hidden tallies) and is **never
  serialized to clients**. Clients receive *views* built by allow-list functions
  (`viewForDisplay`, `viewForPlayer`) whose output is validated by `.strict()` zod schemas — an extra
  field fails validation instead of leaking.
- Option ids are **opaque, per-presentation random ids**, and option order is shuffled per
  presentation; neither correlates with correctness or with database ids.
- Before REVEAL the following keys must never appear in any outbound payload (enforced by the
  payload scanner test and by outbound validation in dev/test/E2E): `correctOptionId`,
  `correctAnswerId`, `isCorrect`, `explanation`, `sourceUrl`, `scoreDelta`/future totals,
  other players' `powers`, `riskTier`, `sabotageTarget`.
- `ANSWER_ACCEPTED` acknowledges *locking*, never correctness.

### Idempotency & ordering on the server
Per-room serial queue ⇒ deterministic processing order; first valid action wins; the DB enforces
uniqueness `(game_id, round_index, player_id)` for answers as a second line of defence.

## Consequences
- `docs/PROTOCOL.md` is generated from the zod schemas (`pnpm gen:protocol`) and checked for drift in CI.

## Verification
Schema round-trip tests, replay/stale/duplicate tests, payload-scanner test over a full scripted
game for every audience (display, each player, spectator-less), outbound-validation test.
