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
| 9 Fake purchase | no entitlement | `red-team/payments.test.ts` › ATTACK 9 | ✅ forged receipts of 14 shapes (alg none, stripped/short/foreign chains, swapped payloads, junk) give nothing; the client cannot assert price/product/tier/account; a genuine receipt replayed by another account never entitles it; 25 concurrent redemptions end in one transaction and one entitlement and two accounts racing for one transaction id have one winner; Google purchases for another account/product or pending give nothing; forged refund notices change nothing; guessing is rate limited |
| 10 Creator requests Blind Quiz raw answers | authorization failure | (todo) | ⏳ needs Blind Quiz (M5) |
| 11 Malicious deep-link parameters | safe rejection | › ATTACK 11 + `packages/validation` link tests | ✅ links, HTTP params, WS params and nicknames |
| 12 Join from another network | success | › ATTACK 12 | ✅ phones bound to different source addresses join and roam mid-game |
| 13 Drop connection mid-question | restore state | `websocket/reconnect.test.ts`, `websocket/client.test.ts` | ✅ answer preserved, token rotated |
| 14 Restart realtime process | recover within limits | `websocket/recovery.test.ts` | ✅ snapshot + log replay, clock frozen during the outage, acknowledged answers survive |
| 15 Poison the bank with reports | bounded, anonymous, only the round's question | `red-team/moderation.test.ts` › ATTACK 15 | ✅ a flood costs one report; no other question can be named; TV, lobby and open questions cannot report; reporter pseudonym is keyed and never shown |
| 16 Evade or probe a ban | identical answers, no spoofing | › ATTACK 16 | ✅ real room, closed room and nonsense answer the same; spoofed `X-Forwarded-For` does not move a ban; nothing about who or why leaks |
| 17 Read or change the switches | public flags only, read-only | › ATTACK 17 | ✅ declared shape, no write route, rate limited |
| 18 Route table is the policy | every admin route has roles + a limit | `red-team/admin-access.test.ts` › ATTACK 18 | ✅ boot refuses an undeclared route; each role reaches exactly its routes; only short ADMIN sessions reach the console |
| 19 CSRF | cookie writes need Origin + header | › ATTACK 19 | ✅ every state change by cookie without proof is refused; no session from URL or invented header |
| 20 Climb: roles, mass assignment, ids | refused | › ATTACK 20 | ✅ editors cannot promote; undeclared fields refuse the request; bad ids end 400/404 |
| 21 Garbage: injection, bombs, prototype tricks | no 5xx, no side effect | › ATTACK 21 | ✅ every list parameter, every write body, import bombs, inert stored markup |
| 22 Guess the sign-in | per-mailbox limit, uniform answers | › ATTACK 22 | ✅ guesses are limited per mailbox however many addresses they come from; wrong code and unknown mailbox are indistinguishable |
| 23 Keep a session that should be dead | immediate | › ATTACK 23 | ✅ revoked, suspended, signed-out tokens and removed roles stop at once |
| 24 Hammer the console | limited per account | › ATTACK 24 | ✅ reads and writes limited apart without hurting others |
| 25 Abuse the TV unlock link | no entitlement from the QR alone | `red-team/payments.test.ts` › ATTACK 25 | ✅ a stranger who claims the link without owning the game unlocks nothing; token guessing is 404/429 with one identical answer; no claim without a sign-in |
| 26 Read a Who Said It statement early / answer for yourself | statement hidden until its question, author exempt | `red-team/who-said-it.test.ts` › ATTACK 26 | ✅ no frame of any client carries a statement before its question is on screen (checked per frame, the TV did get each at its question); no author id anywhere; the author's answer, stake and 50/50 are refused and score/streak do not move; text is moderated, TV/classic room/late sends refused, flood limited |

Findings from running these attacks that changed the code:

- A NUL byte in a query or body reached PostgreSQL and became a 500; a `preValidation` hygiene hook now
  refuses it for every route (`http/hygiene.ts`).
- Admin create mapped a duplicate to a 500; it is a 409 with the outcome.
- Row-level duplicate detection compared identical text across tests; the red-team seeds distinct rows.

- Malformed URLs (`%ff%fe`) were answered by Fastify's built-in handler without our security
  headers; `frameworkErrors` now returns the standard error shape and headers.
- Security events are written off the request path by design; tests poll for them.
