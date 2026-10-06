# Red team: attack → test map

Every brief §26 attack is an executable script in `tests/red-team` (plus the older regression tests
it builds on). The attacker plays against the real server over real sockets; the assertion is always
"the defender's state did not move" or "the defender refused and recorded it".

| Attack | Expected | Test | Status |
|---|---|---|---|
| 1 Modify client score | server ignores | `server-authority.test.ts` › ATTACK 1 | ✅ strict schemas refuse every smuggled field, forged server-type messages and prototype tricks |
| 2 Change client timer | server ignores | › ATTACK 2 | ✅ speed is scored from the server receive time; `clientSentAt` is diagnostic only |
| 3 Answer after deadline | rejected | › ATTACK 3 (+ `game.test.ts`) | ✅ `ANSWER_LATE`, nothing recorded |
| 4 Replay answer packet | rejected / idempotent | › ATTACK 4 | ✅ byte replay → `STALE_SEQUENCE`; re-sequenced replay → duplicate; cross-socket replay refused |
| 5 Replay sabotage packet | rejected | `powers.test.ts` › ATTACK 5 | ✅ byte replay → `STALE_SEQUENCE`; re-sequenced replay → `ALREADY_COMMITTED`; another socket cannot use the frame; replayed next round it meets an empty token pouch; spam of forged targets/effects/fields spends nothing; stakes after seeing the question are refused; no frame ever shows another player's powers |
| 6 Forge host command | rejected | › ATTACK 6 | ✅ `NOT_HOST` + `HOST_COMMAND_FORBIDDEN` event; display identity cannot be borrowed; deposed leader loses powers |
| 7 Enumerate room codes | rate limited, hard | `identity-and-network.test.ts` › ATTACK 7 | ✅ misses cost 4 tokens, identical answers, > 30 days per IP for one hit among 1 000 rooms |
| 8 Steal reconnect token | minimal blast radius, secure invalidation | › ATTACK 8 | ✅ thief = one ordinary slot; victim's return after the grace window revokes the session; nothing else touched |
| 9 Fake purchase | no entitlement | (todo) | ⏳ needs payment verification (M4) |
| 10 Creator requests Blind Quiz raw answers | authorization failure | (todo) | ⏳ needs Blind Quiz (M5) |
| 11 Malicious deep-link parameters | safe rejection | › ATTACK 11 + `packages/validation` link tests | ✅ links, HTTP params, WS params and nicknames |
| 12 Join from another network | success | › ATTACK 12 | ✅ phones bound to different source addresses join and roam mid-game |
| 13 Drop connection mid-question | restore state | `websocket/reconnect.test.ts`, `websocket/client.test.ts` | ✅ answer preserved, token rotated |
| 14 Restart realtime process | recover within limits | `websocket/recovery.test.ts` | ✅ snapshot + log replay, clock frozen during the outage, acknowledged answers survive |

Findings from running these attacks that changed the code:

- Malformed URLs (`%ff%fe`) were answered by Fastify's built-in handler without our security
  headers; `frameworkErrors` now returns the standard error shape and headers.
- Security events are written off the request path by design; tests poll for them.
