# Protocol notes

The wire contract lives in `packages/protocol` (zod, `.strict()` outbound schemas). This page lists what
a client author needs that is not obvious from the types. ADR-0008 explains the design.

## WebSocket (`/ws`)
- Inbound intents: `JOIN`, `HEARTBEAT`, host commands, `ANSWER`, `COMMIT_RISK`, `COMMIT_SABOTAGE`, `USE_FIFTY_FIFTY`,
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
- `QUESTION_PREP` is retired: still in the `PHASES` enum and its phase-data schema so stored data and old clients parse, never emitted; clients treat a received one as `RISK_PICK`.

Purchase errors: `PURCHASE_INVALID` (422), `PURCHASE_ACCOUNT_MISMATCH` (403), `TRANSACTION_ALREADY_BOUND` (409),
`PURCHASE_PENDING` (409), `PURCHASE_REFUNDED` (410), `STORE_UNAVAILABLE` (503, retry).
