# Performance and load measurements

Produced by `pnpm perf --rooms 20 --players 8 --rounds 4` (`scripts/perf/load.ts`); raw reports are in `docs/perf/run-1.json` and
`docs/perf/run-2.json`. Rerun after substantial changes to the server or the protocol and compare with these.

## What was measured, and how

The script creates a throw-away PostgreSQL database (migrated, development bank loaded), starts the **real server as its own Node
process** (`apps/realtime`), and drives it with the shared `GameClient` from `packages/controller-client` over real WebSockets:

1. **Steady:** 20 rooms, each with 1 TV and 8 phones (180 sockets), all playing a whole 4-round game at once. Every phone answers each question 0.1-1.2 s after the options appear, so questions lock early when the last phone answers.
2. **Reconnect storm:** a second batch of 20 x (1 TV + 8 phones); in the middle of the first question **all 180 sockets are killed at the same instant**. Clients reconnect on their own (back-off 50-400 ms); the games must still finish.

Measured: answer acknowledgement time (send until the server's ack), last answer until the TV shows LOCKED and REVEAL, the spread between the first and last phone seeing LOCKED (fan-out skew), join time, reconnect time, the server process's memory and CPU (from `/proc`), server-side input processing time (its own `/metrics` histogram), and PostgreSQL activity (`pg_stat_database` deltas, connection count). Every inbound message is validated against the strict protocol schemas; **protocol violations: 0** in both runs, **server warnings/errors: 0**.

Timings are shortened (answer window 6 s, reveal 0.3 s, `lockedMs` 0.1 s) so a game lasts about 11 s; they change how long a game takes, not how much work each message costs. "Last answer to REVEAL" therefore includes the 100 ms locked pause configured by the script.

## Results (two consecutive runs)

| Measure | Run 1 | Run 2 |
|---|---|---|
| Answer ack p50 / p95 / p99 / max (steady) | 5.8 / 15.3 / 23.0 / 34.7 ms | 6.5 / 51.6 / 87.0 / 101.8 ms |
| Answer ack p50 / p95 / p99 (during storm batch) | 7.0 / 37.9 / 55.9 ms | 6.0 / 30.6 / 71.8 ms |
| Last answer to LOCKED on the TV p50 / p95 / p99 | 6.8 / 15.0 / 37.6 ms | 6.9 / 29.8 / 101.9 ms |
| Last answer to REVEAL on the TV p50 / p95 / p99 (includes 100 ms configured pause) | 107.5 / 125.3 / 364.9 ms | 107.5 / 143.1 / 365.9 ms |
| LOCKED fan-out spread across the 8 phones p50 / p95 / max | 0.6 / 1.8 / 6.5 ms | 0.6 / 1.7 / 5.3 ms |
| Create room + join, p50 / p95 / p99 (160 joins started together) | 137 / 338 / 386 ms | 155 / 336 / 371 ms |
| Whole game wall clock, 20 rooms at once | 11.3 s | 11.4 s |
| Reconnect storm: clients cut / back online within 30 s | 180 / 180 | 180 / 180 |
| Reconnect time p50 / p95 / max | 882 / 1596 / 1638 ms | 614 / 1334 / 1409 ms |
| Games finished correctly after the storm | 20 / 20 | 20 / 20 |
| Answers that had to be re-sent because the socket was cut (storm) | 130 | 96 |
| Server RSS idle / peak / end | 188 / 200 / 200 MB | 183 / 198 / 198 MB |
| Server CPU, whole run | 12.6 s = 44 % of one core | 12.2 s = 43 % of one core |
| Server input processing (reduce + persist + dispatch), 3437 inputs | p50 <= 10 ms, p95 <= 50 ms, p99 <= 100 ms | same buckets |
| PostgreSQL commits (whole run) | 6192 (215/s) | 6162 (215/s) |
| Rows inserted / updated / deleted | 9610 / 5992 / 1313 | 9146 / 5850 / 1234 |
| Buffer cache hit ratio | 100 % | 100 % |
| Peak database connections (pool limit is 12, plus the script's monitor) | 13 | 12 |
| Load-generator event-loop delay p99 / max | 22.6 / 39.4 ms | 23.2 / 49.0 ms |

Reading them honestly:

- The 5-6 ms median ack and the sub-millisecond-to-2 ms fan-out skew are loopback numbers. The p95-p99 tails (15-100 ms) are dominated by this one machine running the server, PostgreSQL and 180 simulated clients on 4 cores, so the load generator's own event-loop delay (p99 about 23 ms, 10 ms is the timer floor) is part of every tail. Run 2's worse tail with the same code shows the run-to-run noise: do not read a difference of this size as a regression or an improvement.
- "Input processing p95 <= 50 ms" are histogram **bucket upper bounds** from `/metrics`, not exact values.
- Reconnect times include the clients' 50-400 ms back-off and a full state resync for 180 sockets at once; the worst client was back in 1.4-1.6 s.
- The database connection count touched the pool limit (12) during the busiest moments of both runs. Nothing failed (no errors, no slow acks beyond the tails above), but with much bigger concurrency (hundreds of rooms in one process) the pool of 12 is the first thing to look at; it is `max: 12` in `app.ts`.

## Against the budgets of ADR-0019 (local numbers; budgets, not production claims)

| Budget | Result |
|---|---|
| Input to lock ack <= 100 ms p95 (8 players) | met: 15-52 ms p95 under 20 rooms at once |
| Reconnect <= 2 s | met: worst client 1.4-1.6 s with 180 simultaneous |
| Room join <= 300 ms | **p50 met (137-155 ms); p95 336-338 ms is above it** when 160 joins start in the same instant, each creating a session row. A single join at a time is far quicker; a real venue joins over seconds, not in one instant. Not investigated further |
| WS connect <= 150 ms | not separated from join in this script |
| First TV render, QR visible, TV heap growth, frame drops | **not measured here** (need a browser trace; Playwright tooling exists but is not part of this script) |

## Memory and leaks

Idle server 183-188 MB RSS (most of it the TypeScript runtime and loaded modules); +12-17 MB with 360 sockets and 40 rooms played in sequence. Rooms closed between the two batches. This is a two-batch run, **not a soak test**: a multi-hour run to look for slow leaks has not been done.

## Caveats

- Server, database and load generator share one 4-vCPU Xeon VM (15.7 GB RAM, Node 22, PostgreSQL 16, Linux 6.18) over loopback. No network latency, no TLS, no proxy.
- Every simulated client has the same source address, so the script raises `MAX_WS_PER_IP` and sets `RATE_LIMIT_SCALE=1000` for the server it starts (production forbids the latter). The real limits were exercised by the red-team suite, not here.
- The script runs the server with the development settings (`NODE_ENV=development`) because production refuses `RATE_LIMIT_SCALE`; outbound schema validation is therefore **on**, which costs a little CPU that production does not spend.
- The real browsers, the TV and the native app were not part of the load. The numbers say nothing about a TV's CPU.
- `pnpm perf --rooms N --players M --rounds R --out file.json` changes the size (rounds must be at least 3). `--keep-db` keeps the database.

## Bottlenecks found

None that justified a code change. Watch items: the connection pool (above), join latency under a simultaneous burst, and the missing soak and browser measurements.
