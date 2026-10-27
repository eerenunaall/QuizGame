# ADR-0006: Timer authority, deadlines, latency and crash recovery

Status: Accepted · Date: 2026-10-06

## Context
GDD §8.2/§37.2 and the brief require server-owned timers and tests at "1 ms before / exact / 1 ms
after" the deadline. Red-Team ATTACK 14 requires state to recover after a realtime restart "within
defined limits" but never says what happens to a running countdown.

## Decision
### Deadlines
- The server stamps `questionStartedAt` (QUESTION entered), `answerOpensAt` and
  `answerDeadlineAt = answerOpensAt + answerMs`.
- **The deadline is inclusive**: an answer with `receivedAt <= answerDeadlineAt + latencyAllowanceMs`
  is on time. `latencyAllowanceMs` is a server-side tuning knob, **default 0** (strict, spec-literal).
  It exists so that real-network playtests can add 100–250 ms of forgiveness without code changes.
  Lock happens at the first tick strictly after the cut-off.
- `receivedAt` is `Date.now()` taken at socket-message arrival, *before* the per-room queue. The
  client-supplied `clientSentAt` is diagnostic only and never influences validity or score.
- Late answers are rejected with `ANSWER_LATE`; duplicates with `ANSWER_DUPLICATE` (the first valid
  answer wins and cannot be changed).
- `speedBonus = floor(speedMax × remainingMs / answerMs)` with `remainingMs` clamped to
  `[0, answerMs]`. With a 15 s window and speedMax 100, 100 ms of latency ≈ 0.67 points: latency
  cannot decide a game; the slope is deliberately shallow.
- Stored answers keep `remainingMs`, **not** absolute timestamps, so they survive time shifts.

### Clock sync for countdown rendering
Clients estimate `serverOffset` with NTP-style samples (`PING` carries `clientSentAt`; `PONG`
returns `serverTime`), keep the minimum-RTT sample of the last 8, and render countdowns from a
monotonic clock (`performance.now()`) plus that offset. Wrong device clocks therefore only affect
cosmetics. Every server message also carries `timestamp` for passive refinement.

### Durability and recovery
- Command pipeline per room is a serial queue: `receivedAt` stamp → validate → reduce (pure) →
  append `room_events` row(s) → commit new in-memory state → acknowledge/broadcast. If the append
  fails the in-memory state is unchanged and the sender gets `INTERNAL` (retry-safe by `messageId`).
- Snapshot on every phase entry; heartbeat (`rooms.last_heartbeat_at`, lease extension) every 5 s.
- **Recovery** (process start or lease takeover): load snapshot, replay `room_events` with
  `seq > snapshot_version`, then compute `outage = now − max(last_heartbeat_at, last_event_at)`.
  - `outage > maxRecoverableOutageMs` (15 min) → room is closed as *interrupted*, scores preserved.
  - otherwise **time is frozen across the outage**: every absolute timestamp of the current phase
    (`phaseDeadlineAt`, `answerOpensAt`, `answerDeadlineAt`, display/abandon timers) is shifted by
    `outage`, and all sessions are marked disconnected until they reconnect. Players therefore keep
    exactly the remaining answer time they had when the process died; nobody is penalised for an
    outage, and acknowledged answers are never lost.
- Targets: process boot → rooms serving ≤ 10 s for ≤ 500 rooms; reconnect after restart ≤ 5 s for a
  client already retrying with back-off.
- Deployment restarts use `SIGTERM` handling: stop accepting new rooms, flush snapshots, close
  sockets with code 1012 (service restart) so clients reconnect immediately.

## Consequences
- The deadline fields in a snapshot can move after a restart; clients must always re-read
  `answerDeadlineAt` from the snapshot (they do).

## Verification
Reducer boundary tests (deadline −1 ms / = / +1 ms, with allowance 0 and non-zero), duplicate
answer, reconnect at the deadline, answer during reveal; integration crash-recovery test with an
injected clock; fencing test.
