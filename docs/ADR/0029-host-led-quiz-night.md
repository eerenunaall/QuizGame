# ADR-0029: Host-led quiz night ("Sunucu modu")

Status: Proposed, not implemented yet (specification for the next developer) · Date: 2026-10-27
Builds on: ADR-0024 (venue mode), ADR-0025 (venue questions), ADR-0026 (teams, simple ruleset),
ADR-0027 (venue admin panel), ADR-0028 (venue displays and question authoring).

## Context
Cafés run their own quiz nights. Guests sit in teams with paper and pen; the café owner is the
quiz master. The owner prepares the questions, shows them on the TV like slides, reads them out,
collects the papers, enters the points and announces the winner. Jokers and sabotages exist, but
they are cards the teams play by raising a hand or writing them on the paper, and the host applies
them. Nobody plays on a phone in this mode. The phone game (ADR-0026) stays as it is; this is a
second way to use the same venue installation.

## Decision

### 1. Where it lives
A new tab in the venue panel (`/staff`, alias `/mekan`): **Quiz Gecesi**. Owner only (staff can be
allowed per venue later). Two screens:
- **Hazırlık** (prepare): create an event (title, date, rounds, questions per round, timer per
  question, jokers on/off), pick questions from the venue's own pool or the Question Studio
  (ADR-0028), order them, register teams (names from the venue's team names, ADR-0026, or typed by
  the host; logos from ADR-0027).
- **Sunum** (present): the owner's tablet becomes the remote. The TV is a paired venue display
  (ADR-0028); the panel sends the event to it. The tablet shows the question, the correct answer,
  the notes and the controls; the TV shows only what the host chooses to reveal.

### 2. The TV as slides (server authoritative)
States per question: `TITLE → QUESTION (options shown) → TIMER (optional countdown) → LOCKED
("kalemler bırakılsın") → ANSWER (correct option revealed, explanation) → next`. Between rounds:
`ROUND_SCORES` (standings after the host entered the points) and at the end `PODIUM`. The host can
go back one step, pause the timer, and jump to the standings. The correct answer never reaches the
TV before the host reveals it (allow-listed views, payload scanner, ADR-0008); the tablet gets it
because the host is the quiz master.

### 3. Scoring from paper
After each round the tablet shows a grid: teams × questions, tap to mark correct (or type points for
open questions). Points per question come from the event settings; the final round may double.
Totals and ranks are computed on the server and shown on the TV. Corrections are allowed until the
event is closed and are logged.

### 4. One card: the 2x joker (owner decision 2026-11-05)
Sabotages, blocks and 50/50 were dropped: guests answer on paper and the options are on the TV, so
there is nothing to whisper or block. The only interaction is the **Çift puan (2x) joker**.
- Before a question is read or shown, teams that want to double it tell the host. The host notes them
  on the tablet (a team picker for the current question) and the pick is **locked the moment the
  question appears on the TV**.
- Each team has a limited number of jokers per night (default 2, editable). The host can limit
  doubling to chosen questions (for example the high-value ones); default: any question of a normal
  round. Remaining jokers show next to each team on the tablet and on the TV standings.
- The **calculator** applies 2x to that team's points for that question automatically when the host
  enters the marking grid; optional setting: a wrong doubled answer costs points (off by default).
- The TV shows a short animation with the team's logo ("Kaplanlar ÇİFT PUAN dedi!").
- Bonus questions (higher base points) and the closest-number tie-break stay.

### 5. Security
- Only a signed-in owner of the venue can create or run an event; the TV must be a paired display of
  the same venue (ADR-0028). Commands are CSRF-protected HTTP or the staff WebSocket channel with
  the venue session; every command is checked against the event's venue.
- Answers live only in the server and the host's tablet view. The TV view is built by an allow-list.
- Events are append-only logged (who changed which score when) so a dispute can be checked.
- Rate limits like other staff routes. Red-team tests: another venue's owner, staff without the
  right, a guest phone, a forged TV, replaying a reveal before the question is shown.

### 6. Out of scope (first version)
Phones for guests, online answering, automatic marking of handwritten answers, sound cues beyond the
existing palette, public leaderboards across events.

## Consequences
Cafés get the quiz night they run today, with better slides and no score sheet arithmetic, on the
same licence and panel. The phone game and the host-led night share questions, teams, logos,
themes and the paired TV, so there is one product to sell, not two.
