# ADR-0026: Teams and the simple ruleset ("Basit mod")

Status: Accepted · Date: 2026-10-27
Builds on: ADR-0007 (scoring), ADR-0008 (protocol, allow-listed views), ADR-0010 / 0021 / 0022 / 0023
(powers, limits, pick phases, new sabotages), ADR-0024 / 0025 (venue mode and venue questions).
First customer: Gusto Board Game Cafe. Guide for the owner: `docs/VENUE.md` ("Takım modu ve Basit mod").

## Context
Café tables are groups of friends, not eight strangers. They want to play as teams (names chosen by us,
never typed by players), with a rule set a crowd understands in five seconds, and the question must stay
on the TV. Nothing may change for the browser game by default: a room that never touches the new settings
plays exactly as before (no new field appears in its views).

## Decision

### 1. Room settings (all optional, absent = today)
`LobbySettings` gains `play` (`INDIVIDUAL` | `TEAMS`), `ruleset` (`FULL` | `SIMPLE`), `teamCount` (2-4,
default 2) and `teamNames` (the venue's own names for the team slots). The leader (phone) or the TV changes
them with `SET_SETTINGS` in the lobby or results. A venue sets its default when staff open a table
(`TABLE_PRESET`, section 7); the leader can still change it on the TV.

### 2. Teams: data and assignment
- **Slots**, fixed by us: `tiger owl fox lion bear dragon whale penguin` (`TEAM_IDS`). A slot fixes the
  **icon** (the avatar artwork of the same id, so no new art), the **colour** (player colour of the same
  position, so the colour-blind checks of THEMES.md already cover it) and the **default name**
  (`team.<id>`, Turkish: Kaplanlar, Baykuşlar, Tilkiler, Aslanlar, Ayılar, Ejderhalar, Balinalar,
  Penguenler; English twins in `packages/i18n`). Colour is never the only cue.
- A venue may rename slots (owner setting, at most 20 characters, screened like any typed text, no two
  equal). Players never type a team name; the only input is a tap on a chip.
- **Offered teams** = the first `teamCount` slots. `Player.teamId` in the lobby; the game copies it into
  `GamePlayerState.teamId` and `GameState.teams { ids, ledgers }` at `BEGIN_GAME` (fixed for the game).
- **Join**: a newcomer lands in the smallest team (ties to the earlier slot) and taps another chip if they
  want. Nobody joins during a game (existing `GAME_IN_PROGRESS`); that is the whole "late join" rule.
- **`ASSIGN_TEAM { teamId, playerId? }`** (lobby and results): without `playerId` you move yourself; with
  one it is a host command (the leader or the TV), `NOT_HOST` otherwise. Errors: `TEAM_INVALID` (not
  offered / room not in teams), `TEAM_FULL`, `PLAYER_NOT_FOUND`.
- **Capacity** per team = `ceil(maxPlayers / teamCount)`, so an offered team can always take a player
  while the room has a seat and nobody can fill the whole room. Changing `teamCount` re-deals the latest
  joiners of an overfull team and everybody of a removed team (join order, smallest team first).
- **Leave / kick / reconnect**: a leaver frees the seat; a dropped phone keeps its team; the team of a
  player never changes by itself.
- **Start** (`START_GAME`, `REMATCH`, and again at `BEGIN_GAME` because players may move while the deck is
  built): at least two teams with players (`NOT_ENOUGH_TEAMS`) and no team more than `teams.maxImbalance`
  (config, default 1) players larger than the smallest team that has any (`TEAMS_UNBALANCED`). Empty
  offered teams are simply not in the game. The TV and the leader's phone show the same check early.

### 3. The simple ruleset
`GameConfig.simple` holds the numbers; `applyRuleset(config, 'SIMPLE')` lays them over the room's full
config at the start of a game (the full config is kept in `RoomState.baseConfig`, so the next game can
choose again). The recorded `config.version` is +1000 so a score audits against the rules that made it.

| | Full | Simple |
|---|---|---|
| Answer window STANDARD / RISK / CROWD | 25 s | **30 s** (venue setting 10-60 s) |
| SPEED / FINAL | 12 s / 20 s | 12 s / 20 s (unchanged) |
| Read phase before the options unlock | 2-5 s | same (`QUESTION` phase, unchanged) |
| Stakes (ladder) | SAFE/RISK/HIGH/ALL_IN | **SAFE only**, FINAL too; no RISK rounds are planned |
| Cover, Duel, Pot, Stake Cap, Cut | on | **off** |
| 50/50, Double Down, shield | 1, 2, 1 | 1, 2, 1 (shield per player, or per team) |
| Sabotages | 8 kinds | **Time Cut (JAM), Shuffle, Blind Clock** |
| Time Cut | 2 s, at most 15 % | **6 s, at most 20 %** of the window |
| Tokens | start 1, max 2, streaks 3/6/9, from round 3 | start 1, max 2, streaks **3/6**, from **round 2** |
| Cooldown / target gap / per target per game | 2 / 2 / 3 | 1 / 1 / 3 |

Why these three: each is one sentence ("shorter time", "answers change places", "no clock on the phone"),
none moves points, and none needs a joker or a stake to explain. Fog looks like a bug, Joker lock and Tax
need a second explanation, Stake Cap has no stakes to cap, Cut pays one player from another. Double Down
keeps the ADR-0021 ceilings (3x of base + speed, loss 200, break-even about 40 %): with the safe rung only
there is no stake pair to forbid. 50/50 and Double Down are the "powers"; the shield is passive.

**One short prep phase.** `RISK_PICK` is the only prep phase (`phaseData.combined`, `offered` = the
sabotage menu); `SABOTAGE_PICK` is never entered. `COMMIT_RISK` (Double Down yes/no) and
`COMMIT_SABOTAGE` are both legal in it. It is entered only when somebody holds a Double Down or can
sabotage, waits only for those players, ends early when they have all decided and otherwise after 10 s.
Progress is a bare count out of everybody online (ATTACK 27: nobody can count token holders). `you.risk`
and `you.sabotage` (`{ ready, decided }`, private) tell a phone what is still its own to decide; the phone
shows Double Down as one switch, three sabotage cards, the rival (a team in team play) and one DONE button.

Every number is data: `GAME_CONFIG_OVERRIDE='{"simple":{"answerMs":{"STANDARD":20000},"sabotage":{"kinds":["JAM"]}}}'`
works, and a venue sets `play.simpleAnswerSeconds` (staff page). The full ruleset is untouched.

### 4. Scoring
Players answer, stake and score **individually**, exactly as in an individual game (a test pins equal
per-player scores). A **team's standing** is derived: `total` = sum of its active members' scores,
`average` = total / members rounded half up. Teams are **ranked by the average**; the total is shown
beside it. Ties break on correct answers per member, then time left per member (exact cross-multiplied
integer comparisons, no floats); teams equal on all three share a rank.
- *Why the average*: 3 against 2 players is fair on points per head and unfair on totals. The total stays
  on screen so the "big table" intuition is visible, and the imbalance rule (section 2) bounds the effect.
- *Members who left* are out of both total and divisor, like a leaver is off the individual board. A
  dropped phone stays a member (it can come back and keeps its seat). Known trade-off: a team could
  profit from a weak member leaving; the reward needs both teams present at the end (section 8).
- *Empty teams* are not ranked; a team whose members all left disappears from the board; a **one-player
  team** and a **two-team game** need no special case. `teamBoard` is public after each question, with the
  individual `scoreboard`; the results carry `teamRanking` beside the individual `ranking` and awards.

### 5. Powers and sabotage per team
- Personal: 50/50, Double Down, tokens (earned by one's own streak, spent by oneself, own cooldown).
- **Sabotage aims at a rival team** (`COMMIT_SABOTAGE { sabotage: { targetTeamId, effect } }`; individual
  play keeps `targetId`; the schema allows exactly one of them). It lands on **every active member** when
  the question starts and is recorded per member (the database rows stay per player).
- **Shield** is the team's: one per game, it blocks a whole hit (all members or none) and is used up.
  The per-target caps (`targetMaxPerGame`, `targetMinGapRounds`, one hit per target per question) count on
  the **team ledger** (`GameState.teams.ledgers`), whoever aims.
- `TARGET_INVALID`: own team, a team not in the game, a team with nobody left, a player aimed at in team
  play, a team aimed at in individual play. A token is not spent on a refusal.
- In the full ruleset with teams, Cut is not offered (it would pay one attacker from many) and a Duel can
  only challenge a rival; the other sabotages apply to each member.
- Privacy: a pick is private until `POWER_RESOLUTION`; victims see what hit them, never who; the power
  screen shows one line per hit on a team.

### 6. The question text stays on the TV
**Verified:** before this ADR a phone never showed the question unless its player switched "show question"
on (default off, regression test in `Controller.test.tsx`), **but it did show the four answer texts**
("A: Ankara"). Owner decision: the answer options (letter + text) **stay on the phone**, as in the default
game; only the question is TV-only. For the simple ruleset that is enforced on the server: `QUESTION` and
`ANSWERING` frames and room views for **players** carry `text: ''` for the question; the options are
untouched (the display gets the full frame; the engine emits two `PHASE_ENTERED` frames only then). The
peek switch disappears; the reveal shows everything again. Honest limit: a second phone, or a friend
reading aloud, defeats any phone-side rule; this removes the cheap path, not the determined one.
**Not built: a "tab left the page" signal.** A visibility event is reported by the client, so it is
spoofable and trivially defeated by a second phone; it punishes legitimate use (a call, a chat, the
screen lock) and would need a penalty rule the table would argue about. If a venue asks for it, it can be
a counter shown to staff (`visibilitychange` count per player, never a score effect).

### 7. Venue
Venue settings gain `play { defaultMode, simpleRuleset, teamNames[], simpleAnswerSeconds|null }` (owner
only, validated, team names screened, default = today). When staff open a table the service sends the
engine input `TABLE_PRESET` (logged, replayable; refused during a game): it sets mode and ruleset, the
names, the café window, and deals seated players into teams. The settings tab of `/staff` edits it.

### 8. Venue reward for a winning team
One code per game, as ADR-0024. In team play: the **single first-placed team** (a tie gets nothing), at
least two ranked teams **each with a phone still connected**, and the existing rules (min players,
daily cap, cool-down, not cut short). The code goes to **one representative**: the best-ranked connected
member of the winning team; the TV says which team won and whose phone holds the code
(`VENUE_REWARD_ISSUED { playerId, teamId }`). Not "a code per member": that multiplies the cost by the
team size, defeats the daily cap and gives every guest an incentive to bring friends in to farm codes. The
staff decide at the counter what the team gets; the code is still redeemed once, by one conditional UPDATE.

### 9. Protocol additions
Client: `ASSIGN_TEAM`; `SET_SETTINGS` += `play`, `ruleset`, `teamCount`; `COMMIT_SABOTAGE` target is
`targetId` xor `targetTeamId`. Server: `TEAM_CHANGED { playerId, teamId|null }`; views gain optional
`players[].teamId`, `you.teamId`, `you.risk`, `settings.{play,ruleset,teamCount,teamNames}`,
`limits.teamImbalance`, `game.teamBoard`, `SCORE_UPDATE.teamBoard`, `RESULTS.teamRanking`,
`RISK_PICK.{combined,offered}`, sabotage items/commitments with `targetTeamId`. Errors: `TEAM_FULL`,
`TEAM_INVALID`, `TEAMS_UNBALANCED`, `NOT_ENOUGH_TEAMS`. Everything stays `.strict()`; nothing hidden is
added (the forbidden-key scan runs over team games).

### 10. Persistence and recovery
No migration: team data lives in the room state (snapshot plus input log, `TABLE_PRESET` and the team
commands are inputs), the persisted game records are per player as before (`ROUND_COMPLETED.sabotages`
has one row per member hit), and `games.config_version` marks the simple ruleset. After a restart the
room replays to the same state including `baseConfig`; the replay tests cover a whole simple team game.
The native app (`apps/mobile`) ignores the new fields and is not extended (ADR-0017 stays browser-only).

## Not built / follow-ups
Team column in `game_players` for analytics; a leader "balance for me" button; more than 8 players;
moving a table's team names mid-game; staff-visible tab-left counter (section 6); the native app.
