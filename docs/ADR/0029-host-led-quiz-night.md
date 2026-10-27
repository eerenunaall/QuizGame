# ADR-0029: Host-led quiz night ("Sunucu modu")

Status: Proposed · Date: 2026-10-27
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

### 4. Jokers and sabotages as cards
Each team gets the same small set per event (default, editable): **Çift puan** (one round counts
double for that team), **50/50** (the host announces two wrong options for that team only, or the TV
shows it on request), **Süre kısalt** (the next question's timer is shorter for a rival team: the host
announces it), **Kalkan** (cancels one sabotage against the team). The host taps the card on the
tablet when a team plays it; the TV shows a short animation with the team's logo; the server
enforces one use per card per team and applies the scoring effect (double round) automatically.

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
