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
