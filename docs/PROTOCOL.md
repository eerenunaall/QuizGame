# Protocol notes

The wire contract lives in `packages/protocol` (zod, `.strict()` outbound schemas). This page lists what
a client author needs that is not obvious from the types. ADR-0008 explains the design.

## WebSocket (`/ws`)
- Inbound intents: `JOIN`, `HEARTBEAT`, host commands, `ANSWER`, `COMMIT_RISK`, `RESPOND_DUEL`, `COMMIT_SABOTAGE`, `USE_FIFTY_FIFTY`,
  `SET_PREFERENCES`, and `REPORT_QUESTION { questionId, reason }`.
- `REPORT_QUESTION` is accepted only from a **player** (not the TV), only for the question of the current
  round, and only in REVEAL, POWER_RESOLUTION, SCORE_UPDATE or MICRO_INTERMISSION. `reason` is one of
  `QUESTION_REPORT_REASONS` (no free text). Answers: `ack`, or an error (`NOT_ALLOWED`, `RATE_LIMITED`,
  `BANNED`, …). Reporting the same question again only updates the reason.
- `SUBMIT_STATEMENT { text }` (Who Said It, player only, LOBBY of a `WHO_SAID_IT` room): one statement per player, a
  second send replaces the first, editable until the game starts. The server runs `sanitizeUserText` (140 characters, no
  links, no profanity); a refusal is `TEXT_REJECTED` with `params.reason` (`EMPTY`, `TOO_LONG`, `FORBIDDEN_CHARACTER`,
  `PROFANITY`, `LINK`). Other errors: `INVALID_STATE` (wrong mode or phase), `FORBIDDEN` (TV), `RATE_LIMITED` (5 burst,
  one per 12 s). Answer: `ACK`. `STATEMENTS_CHANGED { playerIds }` tells every screen who has handed one in (never the
  words; the LOBBY `phaseData.statementPlayerIds` carries the same for late joiners). A player's own words come back only in
  their own `you.myStatement` (lobby). Starting needs at least two statements (`NOT_ENOUGH_QUESTIONS`); the game plays one
  round per statement, capped by the room's round setting.
- Who Said It questions: the statement is the question `text`; the options are all players (`options[].playerId`, text =
  nickname); the correct option is the author, revealed only in REVEAL. The author gets `you.authorOfRound = true` (nobody else
  is ever told) and their `SUBMIT_ANSWER`, `COMMIT_RISK`, `COMMIT_SABOTAGE` and `USE_FIFTY_FIFTY` are refused (`ANSWER_NOT_ALLOWED` /
  `POWER_UNAVAILABLE`); they are not waited for, have no result row, and keep score and streak. Selecting the mode:
  `POST /v1/link-intents/:token/quiz` with `{ mode: 'WHO_SAID_IT' }` (flag `mode.who_said_it`, full game only).
  Statements are never persisted outside the room's event log and snapshot, which are erased when the room closes.
- `REQUEST_UNLOCK_LINK` (display only, FREE room in LOBBY/RESULTS): answered with `UNLOCK_LINK { url, expiresAt }` to that
  connection only, then `ACK`. Errors: `FORBIDDEN`, `INVALID_STATE`, `RATE_LIMITED` (five open links per room).
- `ENTITLEMENT_CHANGED { tier, reason }` goes to every screen of the room when its host account's tier changes.
- Error `BANNED`: the device or address is banned; the answer is identical for a real room, a closed room
  and an unknown code.

## HTTP
| Route | Auth | Notes |
|---|---|---|
| `GET /v1/flags` | public | only flags marked public; `PublicFlagsSchema` |
| `POST /v1/auth/email/request` | public | always `202` (never reveals whether the address exists) |
| `POST /v1/auth/email/verify` | public | body `{ email, code, client: 'ADMIN' \| 'WEB' \| 'MOBILE' }`; browsers get an HttpOnly cookie, `MOBILE` gets a token |
| `GET /v1/me` | session | the signed-in account and its roles |
| `POST /v1/auth/logout` | session | revokes the session |
| `/v1/admin/*` | `ADMIN` session + role | see `apps/realtime/src/admin/permissions.ts` for the role table |

Cookie-authenticated unsafe requests must carry `x-quizparty-csrf: 1` and an allowed `Origin`; bearer tokens
are exempt. Errors are always `{ error: { code, detail? } }`; clients map the code to local copy and never
show server text.

### Purchases, linking and the account
| Route | Auth | Notes |
|---|---|---|
| `GET /v1/entitlements` | player session | `{ tier, entitlements[], storeAccountToken, platforms[] }`; the app passes `storeAccountToken` to the store at purchase time |
| `POST /v1/purchases/verify` | player session | `{ platform: 'IOS', signedTransaction }` or `{ platform: 'ANDROID', productId, purchaseToken }` only |
| `POST /v1/purchases/restore` | player session | up to 10 of the same claims; per-item results |
| `POST /v1/webhooks/apple` | public (signed payload) | App Store Server Notifications V2 |
| `POST /v1/webhooks/google/:secret` | public (secret in path) | Pub/Sub push; a hint, re-read from Google |
| `GET /v1/link-intents/:token` | player session | `{ roomCode, tier }` or 404 |
| `POST /v1/link-intents/:token/claim` | player session | `{ tier, roomCode }` or 404 |
| `GET /v1/me/export`, `DELETE /v1/me` (`{confirm:'DELETE'}`), `DELETE /v1/me/sessions` | session | data-subject rights |

`COMMIT_RISK` is refused with `DOUBLE_DOWN_STAKE_CONFLICT` when Double Down is combined with a stake listed in the `RISK_PICK` phase data's `doubleDownExcludedStakes` (default HIGH, ALL_IN; ADR-0021). Nothing is spent and the player may commit again.

### Risk and sabotage phases (ADR-0022)
Each round runs `ROUND_INTRO` (or `FINAL`) → `RISK_PICK` → `SABOTAGE_PICK` → `QUESTION`; a phase nobody can act in is skipped, so a client must not assume either arrives.
- `COMMIT_RISK { stake, doubleDown }`: only in `RISK_PICK`. `COMMIT_SABOTAGE { sabotage: { targetId, effect, joker? } | null }`: only in `SABOTAGE_PICK`; `null` confirms "no sabotage". Either one in any other phase (a stake in `SABOTAGE_PICK`, a sabotage in `RISK_PICK`) is `INVALID_STATE`. One decision per player and phase (`ALREADY_COMMITTED`); both are final and all-or-nothing. `COMMIT_PREP` no longer exists.
- Phase data: `RISK_PICK` carries the ladder and powers as `QUESTION_PREP` did; `SABOTAGE_PICK` carries `round`, `category`, `difficulty`, `committedCount`, `eligibleCount`. `PREP_PROGRESS { committedCount, eligibleCount }` follows whichever of the two is current. Counts only: never who committed or what (ATTACK 27); in `SABOTAGE_PICK` `eligibleCount` is everybody online, not only token holders.
- `you.sabotage { ready, decided }` (optional, private): the player can sabotage right now (token, cooldown over, a legal target) and has/has not confirmed.
- Timers: `timings.riskPickMs` (12 000), `riskPickDecisionMs` (16 000, RISK and FINAL rounds), `sabotagePickMs` (12 000); all optional in the config, with those defaults.
- `you.sabotage { ready, decided }` (above) is unchanged. ADR-0023 adds, all optional and backwards compatible, the items below.
- `QUESTION_PREP` is retired: still in the `PHASES` enum and its phase-data schema so stored data and old clients parse, never emitted; clients treat a received one as `RISK_PICK`.

### New risks and sabotages (ADR-0023)
- `COMMIT_RISK { stake, doubleDown, cover?, pot?, duel?: { targetId } | null }`: Cover (a fee for a waived stake loss), Pot (an ante into the question's pot) and a Duel challenge, committed with the stake and just as final and all-or-nothing. `RESPOND_DUEL { challengerId, accept }`: the challenged player's reply, only in `RISK_PICK` (`INVALID_STATE` elsewhere); `POWER_UNAVAILABLE` when that player did not challenge you (forged or replayed to a third party), `ALREADY_COMMITTED` for a second reply to the same challenge. No reply by the end of the phase = declined.
- Errors: `BIG_GAMBLE_CONFLICT` (a Duel with HIGH/ALL_IN/Double Down, Cover with Double Down, accepting or taking a big gamble while holding another), `DUEL_LIMIT` (a rival already fought, or a second accepted Duel). `STAKE_INVALID` also covers Cover on a rung with nothing to lose and a stake above a Stake Cap. `TARGET_INVALID` also covers a Duel at yourself, a stranger or an offline player, and Cut at the leader or at a player with no points. `SABOTAGE_LIMIT` covers a Stake Cap that cannot bite (next question in the final stage) and a second economy hit (Cut / POINT_TAX) on one target. `POWER_UNAVAILABLE` covers a switched-off feature or a used-up counter.
- `SabotageKind` += `STAKE_CAP`, `CUT`, `BLIND_CLOCK`. Score components += `COVER_FEE`, `POT`, `DUEL`, `CUT` (so the components of a delta still sum to it).
- `RISK_PICK` phase data: `risks { cover: boolean, duel: { win, bothRight } | null, pot: { ante, minPlayers } | null }` (config, the same for everybody; absent from older servers) and `riskLadder[].coverFee`. `SABOTAGE_PICK` phase data: `offered` (the menu in display order: switched on and legal this round) and `cutRule { permille, maxPoints }`; absent = the five original sabotages.
- `YouView` (private): `powers.{cover, duel, pot}` uses left, `powers.stakeCap` (the highest stake allowed this round), `commitment.{cover, pot, duel}`, `duelInvites [{ challengerId, answer: 'ACCEPTED' | 'DECLINED' | null }]` (only the challenged player), `effects.blindClock`. `hits` and POWER_RESOLUTION list the new effects like any other.
- `POWER_RESOLUTION` items: `COVER { playerId, outcome, fee, saved }`, `POT { playerIds, winnerIds, size, refunded }`, `DUEL { challengerId, rivalId, accepted, winnerId, points }`, `CUT { actorId, targetId, points }` (the points a paid Cut moved). Their content is public only here, after the reveal.
- A `RISK_PICK` waits for a connected challenged player to reply; `PREP_PROGRESS` stays a bare count (a challenged player is "not done" until they reply). Switches and numbers: `GameConfig.powers.{cover,duel,pot,stakeCap,cut,blindClock}`, each with `enabled` (all optional, default on).

### Venue mode (ADR-0024, flag `venue.sessions`)
- `RoomView.venue?: { state: 'RUNNING' | 'PAUSED' | 'ENDED', endsAt: EpochMs | null, remainingMs }` (optional, strict; only on a metered café table). `endsAt` is server time while RUNNING; `remainingMs` is what is left at the frame's server time. Nothing else of a venue is in any room frame.
- `VENUE_METER_CHANGED { venue }` to every screen when staff open, extend, pause or end the table and when its time runs out.
- `VENUE_REWARD { code, text, expiresAt }` to the winner's phone only (and again when it reconnects on the same results); `VENUE_REWARD_ISSUED { playerId }` to the display only (results banner). Neither enters the engine, its log or snapshots.
- `START_GAME` / `REMATCH`: `VENUE_TIME_UP` (no time left, or the table was ended) or `VENUE_PAUSED`. A running game is never cut: when a round ends on a closed meter the game goes to `RESULTS`.
- HTTP (all `session` auth, rate-limited per account, CSRF for cookies; a non-member and an unknown venue both get `404`, a STAFF member on an owner action `403`, everything `404 FEATURE_DISABLED` while the flag is off): `GET /v1/venue/me`; under `/v1/venues/:venueId`: `GET|POST sessions` (open `{ minutes, roomCode } | { minutes, link }`), `POST sessions/:sessionId/extend { minutes }`, `.../pause`, `.../resume`, `.../end`, `POST rewards/redeem { code }` (`409 REWARD_ALREADY_REDEEMED`, `410 REWARD_EXPIRED`, `404`), `GET|POST settings` (owner writes), `GET|POST staff`, `POST staff/:accountId/remove`. Open errors: `ROOM_NOT_FOUND`, `GAME_IN_PROGRESS`, `INVALID_STATE` (TV already has a table), `LIMIT_REACHED` (more than 24 h on one table).
- Admin: `GET|POST /v1/admin/venues`, `POST /v1/admin/venues/:id/owner`, `GET /v1/admin/venues/:id/report?from&to&format=json|csv`.

Purchase errors: `PURCHASE_INVALID` (422), `PURCHASE_ACCOUNT_MISMATCH` (403), `TRANSACTION_ALREADY_BOUND` (409),
`PURCHASE_PENDING` (409), `PURCHASE_REFUNDED` (410), `STORE_UNAVAILABLE` (503, retry).
