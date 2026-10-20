# ADR-0003: System topology, durability and scaling

Status: Accepted · Date: 2026-10-06

## Context
GDD §3/§4: dedicated persistent Node realtime server, PostgreSQL for durable state, Redis optional.
Acceptance R/Q and Red-Team ATTACK 14 require recovery after a process restart "within defined
limits". The GDD does not define "defined limits" or what happens to running timers.

## Decision
**One backend process type**: `apps/realtime` hosts the HTTP API (Fastify), the WebSocket endpoint
(`ws`), the room manager and background jobs. There is no separate REST service, so every rule that
touches game state, entitlements or content has exactly one implementation.

```
TV/Desktop (apps/web /tv) ─┐                    ┌─ PostgreSQL (durable truth)
Phone browser (/game)  ────┼─ HTTPS + WSS ─ apps/realtime ─┤
Native app (apps/mobile) ──┘   (also serves static web)    └─ Redis (optional: rate limits, presence)
Admin SPA (apps/admin) ── HTTPS ───────┘
```

1. **Rooms live in memory on exactly one owner process.** Ownership is a lease row
   (`rooms.owner_instance_id`, `lease_expires_at`, heartbeat every 5 s). Writers are *fenced* by the
   primary key `(room_id, seq)` on `room_events`: a stale owner cannot append after a new owner has.
2. **Durable-before-ack.** Every accepted state-changing command is appended to `room_events`
   (small row) before the sender is acknowledged and before anything is broadcast. A full state
   snapshot (`rooms.snapshot`) is written on each phase entry. Recovery = last snapshot + replay of
   later events through the same pure reducer (ADR-0006).
3. **Redis is optional.** Used for: distributed rate limiting and a presence registry when more
   than one instance runs. With `REDIS_URL` unset everything works in-process. Room routing across
   instances is by consistent hashing of the room code at the edge (documented in
   `docs/DEPLOYMENT.md`); the lease guarantees that a mis-routed request cannot create a second owner.
4. **Static assets**: `apps/web` and `apps/admin` build to static files. They are served by the CDN
   in production and, optionally, by the realtime process (`SERVE_WEB=1`) for single-container
   deployments and for E2E tests.
5. **No serverless realtime.** (GDD §4.3.)
6. **Config & secrets** come only from environment variables validated at boot by a zod schema; the
   process refuses to start with missing production secrets. `.env.example` is committed, secrets never.
7. **Observability**: pino JSON logs with a correlation id per request/connection/room, Prometheus
   metrics (`/metrics`, token-protected), `/healthz` (liveness), `/readyz` (DB reachable, migrations
   current). Error reporting via an `ErrorReporter` interface (Sentry adapter enabled by DSN).
8. **Backups/DR**: `docs/BACKUP.md` (PITR + daily logical dumps + restore drill script), kill-switch
   feature flags (question packs, game modes), instant question retirement (ADR-0014).

## Consequences
- A single instance supports the launch scale; scaling out is an operations change (edge routing),
  not a rewrite.
- Heartbeat/lease timings are configuration, covered by tests with an injected clock.

## Verification
Integration test "crash recovery" (kill owner, start second process on same DB, clients resume);
fencing test (two owners race on one room, loser's append is rejected).
