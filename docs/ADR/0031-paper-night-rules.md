# ADR-0031: Paper-night rules (final wager, joker round, team-name bonus, top-3 estimates, consolation)

Status: Accepted, implemented in `packages/quiznight` + the Quiz Gecesi screens · Date: 2026-11-14
Builds on: ADR-0029 (host-led quiz night). Evidence: `reports/Quiz gecesi mekanikleri ve formatları.md`
(notes in `research_notes/Quiz gecesi mekanikleri ve formatları/`; most figures come from search summaries, not full pages).

## Context
Real paper quiz nights (UK/US pub quizzes, Geeks Who Drink, Turkish quiz-night bars) use a small set of mechanics that
work with pen, paper and a host. The owner's constraints stay: the options are on the TV, so nothing can be hidden from
or whispered to one team; sabotage, steal, block and challenge mechanics exist only in phone games and are **not**
built; the 2x joker declared before the question is shown stays. The owner asked for a fully configurable night.

## Decision
All of these are per-night settings the host chooses in **Hazırlık**. Every new field is optional in the stored
config, so nights saved earlier still parse (`rules()` in `scoring.ts` supplies the defaults).

1. **Final wager** (`config.finalWager`: category + one right/wrong question; `settings.wagerCap`, default 10).
   Four slides after the last standings: `FINAL_INTRO` (category and each team's limit on the TV), `FINAL_QUESTION`,
   `FINAL_ANSWER`, `FINAL_REVEAL` (stakes and results, last place first). A team writes a stake on paper **before the
   question is shown**; the host types it (`WAGER`). Limit = min(cap, points held after all rounds), never below 0.
   Stakes open at the intro and **lock the moment the question is on the TV** (`reached`, BACK does not reopen).
   Right wins the stake, wrong loses it (`MARK` with the id `final-wager`, open from the answer slide); no stake = 0;
   an unmarked team neither wins nor loses. A correction of an earlier round re-clamps the stake that counts.
   The final's points join the totals only from the reveal slide on (the TV never shows them earlier). The final
   answer must be right/wrong, not a number.
2. **2x joker from round N** (`settings.jokerFromRound`, default 1): the pub practice of "not in round 1".
3. **Team-name bonus** (`settings.nameBonus`, 0 = off): the host toggles it per team (`TEAM_NAME_BONUS`); it is added to
   round 1 so every total and the round column already include it.
4. **Top-3 estimates** (`settings.estimateTop3`): the 1st/2nd/3rd closest earn the question's points, 60 % and 20 %
   rounded down (5 -> 5/3/1); equal distance shares a place and skips the next (1, 1, 3). Off = only the closest scores.
5. **Consolation prize** (`settings.consolationText`): shown on the podium for the last-placed team(s); not shown with
   fewer than three teams or when everybody is tied. Text only, no code (the winner's prize code is unchanged).
6. **Recommended template** (`RECOMMENDED`): 3 rounds of 10, an estimate round (3 questions, 5 points), half-time after
   round 2, jokers from round 2, name bonus 2, top-3 on, final wager, tie-break. Chosen by default.

Not built, on purpose: sabotage, steal, block, challenge (no paper evidence, impossible on one TV), all-or-nothing
rounds, half points (arguments), a cash jackpot (not researched for Turkey; prizes stay in kind).

## Security
No new route: the new commands pass the same owner-only, CSRF-protected, expected-sequence command route and the
strict `CommandSchema` (amounts are integers 0..50). The TV view stays an allow-list: `final.limits` only on the
intro, `final.reveal` only on the reveal slide, the question text only from `FINAL_QUESTION`, the answer only from
`FINAL_ANSWER`. Red-team: `tests/red-team/quiznight-final.test.ts` (ATTACKS 90-92).

## Consequences
The host enters one more number per team before the final and toggles; all arithmetic stays on the server. Old logs
replay unchanged because every new behaviour is behind a setting or a new command.
