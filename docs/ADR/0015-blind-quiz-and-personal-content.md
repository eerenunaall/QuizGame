# ADR-0015: Blind Quiz, Who Said It and personal content

Status: Accepted · Date: 2026-10-06

## Context
GDD §11: the quiz author must never see the target's raw answers; the game turns answers into playable
questions; AI is optional, bounded, and must not invent facts. Gaps found while planning:
1. Showing the author the *generated multiple-choice question* (options) before the game would leak the
   answer partially (the correct one is among four visible choices).
2. In the game the author is also a player and sees the reveal ("target's original answer is revealed
   after voting", §7.8) – so "creator cannot see answers" has to mean *outside gameplay / before reveal*.
3. AI "must not invent information" conflicts with generating distractors (wrong options are invented
   by nature).
4. Moderation needs to see reported content, which conflicts with absolute privacy.

## Decision
### Access policy (stored with every response as `visibility_policy`)
`TARGET_ONLY` (default) → `GAME_ENGINE` (after the target approves a derived question) →
`REVEALED_IN_GAME` (at REVEAL, wording shown to the room if the target allowed it). There is **no
policy value that exposes raw responses to the creator via any API**.
- **Structural enforcement:** raw responses and derived questions are readable only through a
  `BlindVault` module whose public methods are `putResponse(inviteToken, …)`, `listForTarget(inviteToken)`
  and `playableForGame(gameId)`; the last is callable only from the realtime process during deck
  building and returns opaque `PlayableQuestion` objects. No route handler imports the repository
  tables directly (lint rule + import test). Creator endpoints return prompts and **completion status
  only**.
- **Encryption at rest:** AES-256-GCM per response, key from `BLIND_DATA_KEYS` (id→key, rotation by key
  id), AAD = `responseId|promptId`. This protects against DB dumps and misconfigured replicas, not
  against an operator holding the key — stated in the consent text and in `docs/SECURITY.md`.
- **Canary test:** a sentinel string is stored as a response; the test replays *every registered
  HTTP route and every WebSocket audience* as the creator (and as TV, other players, admin without the
  moderation capability) and asserts the sentinel never appears, in any response body, header or frame.

### Flow
1. Creator makes a quiz, adds targets (display names) and prompts (curated catalogue or custom, both
   moderated) and gets one **invite link per target** (`/blind/respond/<256-bit token>`), shared
   manually. Targets need no account.
2. Target reads the consent text, answers (≤ 140 chars), may add up to 3 plausible wrong alternatives
   *they* write, previews the question **privately**, approves/edits/deletes each one.
3. Creator sees: prompt list, per-target `PENDING/ANSWERED/APPROVED` counts. Never text, never options.
4. Game: `playableForGame` yields questions whose **text comes from deterministic prompt templates**
   (not AI) with the target's display name; the correct option is the target's text verbatim; options
   are shuffled with opaque ids. REVEAL shows the correct option and, if allowed, the original wording.
5. **Retention:** responses and derived questions are hard-deleted 30 days after the last game that
   used them, immediately on target request (`DELETE` with the invite token) or when the creator deletes
   the quiz; a nightly job enforces it. Analytics never contain text.

### Bounded AI
AI is **only** allowed to propose *decoy options* when the target ticked "suggest alternatives for me"
and `blindAiDecoys` is enabled with a configured provider. Input: prompt text + the target's answer
only. Output: JSON `{ decoys: [3 strings] }`, validated (length, not a near-duplicate of the answer, no
profanity). Whether a decoy is plausible – or accidentally true – cannot be machine-verified, so the
**target reviews every decoy before use**. The correct answer and question wording are never
AI-written, so the model cannot invent a fact about the target. No prompt/response logging beyond the
retention window.

### Who Said It
Players submit short statements from their phones in the lobby (`SUBMIT_STATEMENT`, ≤ 140 chars,
moderated, one per player and editable until the start as built in M5-d). The engine builds questions whose options are the players (opaque ids) and whose
correct option is the author; the author's own phone shows "this one is yours" and scores nothing for
that round. Statements live in room-scoped storage with `expires_at` = room close + 24 h.

### UGC safety
Profanity/hate filter at write time (ADR-0018), per-room report button (`REPORT`) on any shown
question, block-list per account, moderation cases with a content snapshot visible only to
`MODERATOR`/`ADMIN` roles (disclosed in the consent text), deletion paths above.

## Addendum (M5-e/f, 2026-10)
**Invite claim (ATTACK 10).** The creator hands out the invite link, so the link cannot be the only
credential for reading answers. The first `consent` on an invite mints a 256-bit claim secret, returned
once as an HttpOnly, SameSite=Strict cookie scoped to that invite's API path (`blind_targets.claim_hash`
keeps only its keyed hash). Before the claim the invite opens the consent step and nothing else exists
to read; after it, view/put/approve/suggest/delete need the cookie (`FORBIDDEN` otherwise) and
`rotateInvite` is refused. Whoever consents first owns the invite: a creator who does so gains no
access to anything the target writes later and the target is simply refused. A target who loses the
cookie is re-invited by removing and re-adding them (their answers are destroyed, never shown).

**AI decoys, exactly what is sent.** Route `POST /v1/blind/respond/:token/prompts/:promptId/suggest-decoys`
(claim required, one explicit press by the target, only for an answer they already stored), flag
`ai.decoys` (default off) plus `AI_DECOYS_API_KEY`/`AI_DECOYS_MODEL` (`AI_DECOYS_API_BASE`,
`AI_DECOYS_TIMEOUT_MS`). The only wire payload besides fixed instructions is
`{language, question, answer}`: the question is the catalogue prompt or custom prompt text with the
target's name removed, the answer is the target's own text. The ADR allows the answer (a wrong option is
defined against it); nothing else leaves: no name, quiz title, ids, invite, other answers or the
target's earlier alternatives. The key travels only in the request header and is never logged or put
in an error. One attempt inside a deadline (default 4 s), circuit breaker (3 failures, 30 s), reply
must be strict `{decoys: 1..3 strings}`, each sanitised like user text and dropped when it equals,
contains or resembles the answer or another suggestion. Suggestions are returned to the target only,
stored nowhere by this path and still need the target's own review and approval. Off, unconfigured,
failing or unusable output all answer `{decoys: [], source: 'NONE'}`: the target writes their own
alternatives, which is the non-AI path. Counters `qp_ai_decoys_total{result}` carry no content.

## Verification
Canary test (above), approval-gate test (unapproved questions never reach a deck), retention-job test,
encryption round-trip + AAD tamper test, AI adapter test against an HTTP double asserting that only
the answer text is sent and that invalid output is rejected.
