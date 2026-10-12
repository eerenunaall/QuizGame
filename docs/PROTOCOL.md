# Protocol notes

The wire contract lives in `packages/protocol` (zod, `.strict()` outbound schemas). This page lists what
a client author needs that is not obvious from the types. ADR-0008 explains the design.

## WebSocket (`/ws`)
- Inbound intents: `JOIN`, `HEARTBEAT`, host commands, `ANSWER`, `COMMIT_PREP`, `USE_FIFTY_FIFTY`,
  `SET_PREFERENCES`, and `REPORT_QUESTION { questionId, reason }`.
- `REPORT_QUESTION` is accepted only from a **player** (not the TV), only for the question of the current
  round, and only in REVEAL, POWER_RESOLUTION, SCORE_UPDATE or MICRO_INTERMISSION. `reason` is one of
  `QUESTION_REPORT_REASONS` (no free text). Answers: `ack`, or an error (`NOT_ALLOWED`, `RATE_LIMITED`,
  `BANNED`, …). Reporting the same question again only updates the reason.
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

Purchase errors: `PURCHASE_INVALID` (422), `PURCHASE_ACCOUNT_MISMATCH` (403), `TRANSACTION_ALREADY_BOUND` (409),
`PURCHASE_PENDING` (409), `PURCHASE_REFUNDED` (410), `STORE_UNAVAILABLE` (503, retry).
