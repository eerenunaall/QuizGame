# Risk and sabotage variety — research and proposal

Status: proposal for owner review (no code changed) · Date: 2026-10-19
Builds on: ADR-0007 (scoring), ADR-0010 (powers), ADR-0020 (visual direction), ADR-0021 (one big gamble),
GDD §7.3-7.6 and §13. Engine facts below were read from `packages/game-engine/src/{config,powers,scoring}.ts`.

## 0. How to read this

- **Verified** = stated by a source I could read in a search result. **Inference** = my reading or estimate.
- Method limit: `WebFetch` could not reach the web in this sandbox (DNS failure), so every external
  claim comes from search-result summaries, not full pages. Treat section 1 as a good sketch, not a
  citation-grade survey. Evidence for Trivia Crack is thinner than for Knowledge is Power; the
  Trivia Crack "crowns/characters" mechanics are mostly from 2015-2016 era reviews and may be out of date.
- Nothing here copies those games' item names, art or wording. All proposed names are original.

### What QuizNight has today (engine, verified in code)

| Area | Current set | Key numbers (defaults) |
|---|---|---|
| Stakes | SAFE x1/loss 0, RISK x2/loss 100, HIGH x3/loss 200; FINAL: RISK x2/150, HIGH x3/250, ALL_IN x5/400 | base 100 (FINAL 200); speed 0..100 (SPEED round and FINAL 200); speed is not multiplied by the stake |
| Jokers | 50/50 (x1 per game, reward x1/2), Double Down (x2 per game, x2 gain, +200 loss) | Double Down excluded with HIGH/ALL_IN; ceiling 3x base+speed (FINAL 5x); `maxGainPerQuestion` 1500 (FINAL 2500) |
| Defence | Shield x1 per game, blocks the first incoming hit (attacker's token is still spent) | |
| Sabotage | `JAM` (-2 s, max 15 % of window), `SHUFFLE`, `FOG` (one option hidden 1.5 s), `LOCKOUT` (one joker blocked next round), `POINT_TAX` (25 % of next gain burned, lapses after 3 rounds) | start 1 token, max 2, earned at streak 3/6/9, not before round index 2, never in FINAL, cooldown 2 rounds, max 2 per round, one hit per target per round, target gap 2 rounds, max 3 hits per target per game |
| Windows | `prepQuickMs` 6 s (ordinary), `prepDecisionMs` 10 s (RISK/FINAL), answer window 25 s (SPEED 12 s, FINAL 20 s) | reduced-effects players get SHUFFLE/FOG as half a JAM |

Known property worth keeping in mind: sabotage today is almost all **time or perception** (JAM, SHUFFLE,
FOG) plus one **economy** (POINT_TAX) and one **decision-space** (LOCKOUT) effect. The proposals below
mostly widen the economy, decision-space and social axes, because the perception axis is already full.

---

## 1. What the reference games do

### 1.1 Knowledge is Power (PlayLink, PS4; PlayStation Hits re-release)

Verified (search summaries of reviews/store/Wikipedia):
- Up to 6 players use phones as controllers, the TV shows questions; points depend on how fast you
  answer, not only on being right. Players vote on categories from a choice of four.
- **Power Plays** are the central tactic. Before each question a player chooses either a
  **self-benefit** (examples reported: remove wrong answers from your own screen, double points,
  betting on another player) or a **prank on one opponent** that you pick as the target.
  Sources: Wikipedia ("prior to every question, players can select either a strategic advantage ... or
  send a prank to an opponent's screen"), CogConnected ("not all negative ... double points or betting
  on another player"), TheSixthAxis / GamingTrend (target is chosen after picking the play).
- Reported prank visuals, all aimed at slowing the lock-in: **Ice** (answers frozen, tap through to
  use them), **Gloop** (slime covers all four answers, wipe it away on the phone), **Bombles**
  (timed explosions that can briefly cut out your time or obscure answers). A reviewer notes these hurt
  because scoring is fastest-answer-based.
- A **Power Pick** can lock in your preferred category (CogConnected).
- Which Power Play you get seems tied to a **step you are on** (a search summary of the store text);
  I could not confirm what "step" means in the main game. Treat as unverified.
- Finale: a **Pyramid of Knowledge** race; wrong answers stop your climb. One review says start
  positions follow earlier results, giving leaders "only a slight head start", i.e. the finale
  resets most of the lead.
- The sequel (Decades) kept some Power Plays and added new ones; the PlayStation Blog names Disco
  Fever, Zipper and Lockdown (names only; effects not confirmed).
- Reception: mischief is described as "mean-spirited but intentional", used "to keep anyone from
  pulling ahead"; another reviewer calls the hazards goofy. Overall reviews are mixed and some mention
  repetition. No review I saw reports a balance or griefing postmortem.

Inference (design reading, not stated by sources):
- Pranks are **visual and tactile**, never score-altering, so they are funny and non-lethal. Their
  cost is borne in speed points, which matches our `JAM` family.
- Choosing a prank *before* the question (not under the timer) is the structural choice we already
  share (QUESTION_PREP).
- Targeting is free choice, so the leader attracts attacks, which the reviewers read as an intended
  catch-up pressure. We deliberately forbid rubber-banding that inflates trailing players (GDD §13.2),
  but attacker agency against the leader is allowed and already limited per target.

### 1.2 Trivia Crack (Etermax; asynchronous 1v1 mobile, plus board-game spin-offs)

Verified:
- Win condition: collect **six characters** (one per category: Science, Entertainment, Art,
  Geography, Sports, History); a match is capped at about 25 rounds and, in some descriptions, the
  most crowns wins (sources disagree). Sources: AppleVis threads, GameSkinny, Windows Central, MobyGames
  (search summaries).
- A **crown** is earned by answering a question right after three correct in a row, or landing on the
  crown tile. With a crown you choose: **challenge the opponent for one of their characters** or answer
  a fresh question for a character of your choice. A challenge is the same six questions (one per
  category) for both; the higher score wins and the loser **loses the character**. Turn continues
  until you answer wrong.
- Coins buy power-ups (official help centre article lists: **Bomb** removes two wrong answers,
  **Double chance** gives a second try after a wrong first pick, **Extra time** adds 15 s once the
  timer ran out and you pay, **Right answer** auto-picks the correct option; you start with three of
  those). Coins come from wins or purchases. Earlier AppleVis review also lists Skip; not confirmed
  by the help centre excerpt.

Inference:
- Trivia Crack's "risk" is mostly **economic and out-of-match** (coins, purchases) and a **head-to-head
  stake** (the challenge can cost you an owned character). Its "attack" is the steal-challenge, a
  consensual-looking duel, not a screen prank. That is a useful contrast: the two games give us
  two families, **duels / transfers** (Trivia Crack) and **screen pranks** (Knowledge is Power).
- Its power-ups are mostly remedies bought for coins. Our money rules (ADR-0013) forbid paying for
  in-match advantage, so we should take the *shape* (information/time remedies) but earn them in-game.

### 1.3 Gaps in the evidence

No official Knowledge is Power power list was readable; no postmortem for either game was found;
Trivia Crack numbers (rates, costs) are unknown. All balance numbers below are ours.

Sources (search results only; pages themselves were not fetched):
- https://triviacrack.help.etermax.com/hc/en-us/articles/360024775733-Power-ups
- https://www.applevis.com/comment/34447 (and sibling AppleVis Trivia Crack comment pages)
- https://www.gameskinny.com/reviews/review-trivia-crack-will-challenge-your-knowledge-and-friendships/
- https://windowscentral.com/trivia-crack-review-online-trivia-game-windows-phone-potential
- https://www.mobygames.com/game/72918/
- https://en.wikipedia.org/wiki/Knowledge_is_Power_(video_game)
- https://cogconnected.com/review/knowledge-is-power-review/
- https://www.thesixthaxis.com/2017/11/22/knowledge-is-power-review/
- https://gamingtrend.com/reviews/friend-turned-foe-show-what-you-know-knowledge-is-power-review
- https://godisageek.com/reviews/knowledge-is-power-review/
- https://checkpointgaming.net/reviews/2017/11/knowledge-is-power-review/
- https://store.playstation.com/en-gb/concept/225226 (store listing)
- https://blog.playstation.com/?p=205595 (Decades announcement)

---

## 2. Design principles: fewer rushed or panicked choices

Mostly my synthesis; the first two mirror what both games do structurally (verified above: choices are
made before the question, targets chosen by the player).

1. **Decide before the clock, not during it.** Every new risk/sabotage is committed in QUESTION_PREP,
   never while the answer timer runs. (Already true; keep it as a rule for every new item.)
2. **Two separate windows.** Window A "plan" (stake, jokers, side bets) and window B "aim" (pick a
   target) should not compete for the same 6 s. For anything needing a target (sabotage, Duel, Backer)
   show targets as a second sheet after the stake is chosen, with its own "skip" button as the
   default focus. Inference: the 6 s quick prep is tight for 3 decisions; extend `prepQuickMs` to
   about 8 s only on rounds where a target-based item is available (owner decision, section 6).
3. **Default is the cheap, safe choice.** Pre-selected state = no gamble, no spend. Timing out never
   commits a bet (already true: the commitment is created only by `COMMIT_PREP`).
4. **Visible price and stakes in the button.** Each option states "+X / -Y" in numbers and icon+text
   ("Risk: win 250 / lose 100"); never colour only.
5. **Two-step commit for expensive items.** Anything that spends a token or a once-per-game item uses
   a tap + hold/confirm (0.6 s) with an undo until prep ends. Today a committed power cannot be
   withdrawn (ADR-0007); softening that to "withdrawable until prep closes, spent on close" is
   server-cheap and removes most regret. Open question for the owner.
6. **Never gate a decision behind a surprise.** The target of a sabotage learns of it when the question
   opens (not mid-answer), and the effect list is on screen so the cause is readable.
7. **One big gamble per question** (ADR-0021) generalises: items are classified BIG or SMALL (below).
   At most one BIG item per player per question; SMALL items stack but never exceed the ceiling.
8. **Bound the swing.** Every transfer or loss has a per-item cap and sits under `maxTotalMultiplier`
   and `maxGainPerQuestion`; there is always a `CAP` audit component (ADR-0021) when it bites.
9. **Counterplay is visible and available before the question.** Shield already exists; extend with a
   second kind of defence (Mirror, section 4).
10. **Accessibility first.** Every effect has an icon, a one-line text and a `reducedEffects`
    fallback (the existing half-JAM pattern); no effect depends on colour or on fast motion.

Classification used below:
- **BIG** = HIGH, ALL_IN, Double Down, Duel, Two-Step second leg. At most one per question per player.
- **SMALL** = 50/50, Trim, Cover, Pot, Backer, Against the Herd. May combine with a BIG item.
  (Cover only attaches to RISK/HIGH/ALL_IN; Trim and 50/50 are mutually exclusive on a question.)

---

## 3. New risk and joker types (7)

Notation: base 100, speed mean 50, so a correct SAFE answer is worth 150. RISK win 250, loss 100.
HIGH win 350, loss 200. All values are `GameConfig` fields (versioned, optional so old snapshots parse),
following ADR-0021's pattern. "Break-even p" is the accuracy where EV equals the plain alternative.

### R1. Güvence / Cover (SMALL, joker, complexity S)

- Rule: pay a fee equal to half the stake's loss (RISK 50, HIGH 100, ALL_IN 200) when committing; if the
  answer is wrong or missing while connected, the stake loss (and Double Down extra loss) is waived.
  Fee is paid even when right. 1 per game. Only with RISK/HIGH/ALL_IN (nothing to insure on SAFE).
- Server: `COMMIT_PREP { cover: true }`; `checkCommit` refuses with `POWER_UNAVAILABLE` / `STAKE_INVALID`.
  Fee is a `COVER_FEE` score component, never below zero (`min(fee, score)`); in scoring, wrong-answer
  branch sets `loss = 0`. Pure function, easy fast-check property.
- Info needed/leaks: none.
- Balance: Cover beats no-cover when `(1-p) * loss > fee`, i.e. `p < 0.5` for every tier. RISK p=0.4:
  no cover 350*0.4-100 = 40; cover 250*0.4-50 = 50. p=0.6: 110 vs 100. HIGH p=0.6: 130 vs 110. It
  moves risk-averse players toward RISK/HIGH without making them dominant (never better than uncovered
  at p>0.5). Fee scaling at half the loss is what prevents "HIGH + Cover" dominating RISK.
- Counterplay: none needed (self item). Interacts with POINT_TAX normally.
- Abuse/grief: none; slight dragging of fast-play; mitigated by 1 per game.
- Presentation: icon = umbrella; button "Cover: -50 now, a miss costs 0" / TR "Güvence: şimdi -50, yanlışta kayıp 0".
- Why: addresses casual players' fear of the ladder; direct analogue of the "remedy" power-ups in
  Trivia Crack but earned, not bought.

### R2. Meydan Okuma / Duel (BIG, head-to-head, complexity M)

- Rule: choose one opponent in prep. On reveal, among the two of you: you right and they wrong or
  unanswered, you take 80 from them; they right and you wrong, they take 80 from you; both right, the
  faster answer takes 40; both wrong, nothing. Max 1 per player per question, 2 per game, never against
  the same opponent twice, a player can be challenged at most once per question. Capped by the
  loser's current score (no negative scores).
- Server: `COMMIT_PREP { duel: { targetId } }`; validated like sabotage target (`TARGET_INVALID`, new
  `DUEL_LIMIT`). Resolved after answers lock: needs only already-server-known `correct` and `remainingMs`.
  Writes two paired `DUEL` score components (one per player) that sum to zero. Counts toward
  the 3x ceiling: transfer is outside the multiplier chain and added after the ceiling, so the ceiling
  is not violated by design; still add a `maxDuelTransfer` config.
- Info needed/leaks: none before reveal. Target is told "X challenged you" when the question opens;
  that is a commitment, not a hidden answer.
- Balance: zero-sum for equal skill: EV 0 (win +80 x P(me right, them wrong) = lose 80 x P(them right,
  me wrong)). For a 70 % vs 50 % pair: P(win)=0.35, P(lose)=0.15, both right 0.35 x 0.5 faster x 40 = +/-7
  net ~0 → EV +16 for the stronger. It rewards being better, costs nothing in expectation vs an equal.
  Total points in the room are conserved (a good property: no inflation, no rubber-banding).
- Counterplay: shield does not block it (it is not a sabotage); target's counterplay is to answer well
  and use Cover. Optional decline (costs 20) is an open question.
- Abuse/grief: collusion - A throws a Duel to B to funnel 80 points. Bounded by once per pair per
  game; also add the rule "an unanswered Duel challenger loses 80 even if disconnected" so they cannot
  dodge. Dog-piling the leader is bounded by "challenged at most once per question" and per-target
  Duel gap. In a 2-player room Duel is always the same pair: disable below 3 players.
- Presentation: icon = crossed swords; TV shows two avatar rings joined by a bar and "80". Text:
  "Duel: take 80 from Ayşe if you are right and she is not" / TR "Meydan okuma: sen doğru, Ayşe yanlışsa 80 puan senin".
- Why: takes Trivia Crack's steal-challenge shape (verified in 1.2), but conserves points.

### R3. İkili Seri / Two-Step (BIG on the second leg, complexity M)

- Rule: in prep of question N announce "two in a row": if you answer both N and N+1 correctly you
  get +150 after N+1; if either is wrong or missing you lose 100 at that moment. 1 per game, not into or
  across FINAL, not on the Who-Said-It exempt round.
- Server: new ledger field `twoStep: { startRound, state }`; evaluated in the same place that updates the
  streak. `COMMIT_PREP { twoStep: true }`; second leg counts as BIG for question N+1 (so no HIGH/Double
  Down with it), but question N is not constrained. Bonus enters before the ceiling step so
  RISK + max speed + bonus = 450 equals the 3x cap exactly.
- Info needed/leaks: none.
- Balance (independent answers, accuracy p per question): EV = 150 p^2 - 100 (1 - p^2); break-even
  p^2 = 0.4, p = 0.63. p=0.5: -37; p=0.7: +22; p=0.8: +60; p=0.9: +99. Strong players are rewarded, weak
  ones are steered away (and the item is 1 per game).
- Counterplay: none directly; opponents can sabotage the second leg (JAM etc.), which is intended and
  visible ("Two-Step running" badge on TV, so attackers choose to hit it). The badge is public by design, so
  nothing hidden is revealed.
- Abuse/grief: stacking on a lead to lock it in; bounded because it needs two correct answers and costs
  100 on failure. Disconnection counts as a miss (consistent with ADR-0007 for committed stakes).
- Presentation: icon = two linked chain rings; "Two in a row: +150, miss: -100" / TR "Üst üste iki: +150, kaçırırsan -100".

### R4. Daraltma / Trim (SMALL, lifeline, complexity S)

- Rule: remove one wrong option for you; gain x4/5 (floor). 2 per game. One lifeline (Trim or 50/50)
  per question.
- Server: reuse the 50/50 machinery. **Pooling rule**: choose the Trim-removed wrong option first, once
  per question and shared by all users; then 50/50 picks its kept wrong option from the two remaining.
  Without this, a Trim user and a 50/50 user could compare screens and eliminate down to the answer.
  (Same protection ADR-0007 gives 50/50 pairs.) Needs a change in `chooseFiftyFifty`.
- Info: removes one wrong option per question; reveals nothing beyond what 50/50 reveals.
- Balance (uniform guessing among remaining): p 0.25 -> 0.333 x 0.8 = 0.267 (vs 0.25: tiny edge for a
  blind guesser, intended); knowing 2 options (p 0.5 -> 0.667 x 0.8 = 0.53). Essentially EV-neutral
  with lower variance, the same logic ADR-0007 uses for 50/50.
- Counterplay/grief: none. Low novelty on its own; included because it gives players a second,
  cheaper lifeline so 50/50 is not the only escape.
- Presentation: icon = scissors on a card; "Remove one wrong answer, gain x0.8" / TR "Bir yanlış şıkkı kaldır, kazanç x0,8".

### R5. Ortak Kasa / Pot (SMALL, social, complexity M)

- Rule: ante 30 into a pot for this question. All who anted and answered correctly split the pot
  equally; remainder goes to the fastest correct. If nobody is right the ante is refunded. Max 2 per
  game per player. Min 3 anted players for the pot to run; otherwise refunded.
- Server: `COMMIT_PREP { pot: true }`; antes held at lock, settled in the same reveal as score deltas, as a
  `POT` component. Point conserving. TV shows "Pot 90 (3 players)" before the answer; that leaks only
  participation, which is not hidden state.
- Balance: with 4 anted players all at 60 % accuracy, an expected correct player takes about 120 / 2.8
  = 43; EV = 0.6 x 43 - 30 = about -4. A strong player (80 %) in a field of 55 %: expected other
  correct 3 x 0.55 = 1.65 -> share 120 / 2.65 = 45; EV = 0.8 x 45 - 30 = +6. Close to zero; a "fun tax"
  that moves points from weak to strong slightly, so cap at 2 per game.
- Counterplay: do not join (it is opt-in). Sabotage still applies (JAM on a Pot member hurts them).
- Abuse/grief: nothing: opt-in, flat 30, conserving. Collusion cannot create points.
- Presentation: icon = clay jar; "Join the pot: 30 in, split by the right answers" / TR "Kasaya gir: 30 ver, doğru bilenler paylaşır".

### R6. Destekçi / Backer (SMALL, social, complexity M)

- Rule: stake 30 on another player answering correctly this question. Payout from the bank is
  `clamp(round(30 x (1-q)/q), 10, 90)` where `q` is that player's smoothed accuracy over the
  game so far `(correct+1)/(answered+2)`; lose 30 if they are wrong. 1 backing per question, 3 per
  game, not yourself, not on a player in a Who-Said-It exempt round.
- Server: `COMMIT_PREP { backer: { targetId } }`. Needs only already-public result history. The
  settlement uses the target's post-lock `correct`. Odds are stored in the audit component for
  reproducibility.
- Info/leaks: none. Do not show live odds computed from answers made this question.
- Balance: fair-odds by design: if `q` is the true chance, EV = 0 (minus clamp edges: q=0.8 payout is
  10 not 7.5, so +2 for backing a true 80 %). Skill: judge when a normally reliable player is in a bad
  topic. Inflates total points slightly (bank pays); bounded by 3 per game.
- Counterplay: attackers can sabotage the backed player (visible badge "Backed by 2"). That makes
  Backers an incentive to hit the leader while others bet on the leader... interesting tension, but
  bounded by existing target limits.
- Grief: collusion needs a partner to throw answers; bank pays only up to 90, a pair gains at most
  90 per use x 3 - acceptable; flag in red-team tests.
- Presentation: icon = hand on shoulder; "Back Ali: +20 if right, -30 if wrong" / TR "Ali'yi destekle: doğruysa +20, yanlışsa -30".
- Origin: the *idea* of betting on another player is reported for Knowledge is Power (CogConnected, 1.1);
  the odds-based payout is ours.

### R7. Sürü Dışı / Against the Herd (SMALL, social, complexity M)

- Rule: if you answer correctly and at most 25 % of the players who answered picked the same option,
  +100. If you are wrong, -30. Correct with the majority: 0 extra. Needs 4+ answering players; 2 per game.
- Server: needs the final per-option tally, which exists at lock (CROWD rounds already compute it).
  Nothing sent before reveal.
- Balance (estimate; needs the question-stats table to simulate): I assume the player is
  correct-and-in-the-minority ~10 % of the time and wrong ~30 %: EV = 0.1 x 100 - 0.3 x 30 = +1. Only
  a bluffer's item; low expected use. **Weakest evidence of the seven**; included for variety.
- Counterplay: none. Grief: none (self item). Possible collusion: friends agree on a wrong majority
  to deny; bounded by the 25 % rule needing 4+ players.
- Presentation: icon = lone sheep/arrow against a crowd of arrows (draw as arrows, no animal needed);
  "Right while few agree: +100" / TR "Az kişi doğruyu bilirse: +100".

### 3.1 Risks I considered and rejected
- **Comeback refund** (a wrong high stake refunded next question): rubber-banding, breaks GDD §13.2.
- **Pay-to-win / bought power-ups** (Trivia Crack coin model): forbidden by ADR-0013.
- **Hidden-info peeks** (see how many chose each option live): leaks, violates ADR-0008.
- **x4 or more multiplier combos**: break the 3x ceiling.

---

## 4. New sabotage types (7)

Common rules (inherit from today's engine): token spent from `powers.tokens`, same limits
(cooldown, maxPerRound, per-target gap and cap), shield blocks the first hit, presentation-only
or decision-space (never fraud with answers or results), `reducedEffects` fallback shown in each item.
"Hits" always appear in the POWER_RESOLUTION list (`kind: 'SABOTAGE'`, new `effect` literals in
`SABOTAGE_KINDS`; the protocol enum, strict outbound schemas and payload scanner need updating together).

Reference cost: JAM = 2 s of 25 s = about 8 speed points (inference at mean speed formula).

### S1. Tavan / Stake Cap (decision-space, complexity S)

- Rule: target's highest allowed stake in the next question is RISK (HIGH removed from their ladder).
- Server: same slot as `LOCKOUT`: `target.powers.lockout`-like `stakeCap: { round, tier }` read by
  `roundLadder` / `checkCommit` (`STAKE_INVALID`). Not applied if the next round is the FINAL (would
  remove ALL_IN from the finale): refused with `SABOTAGE_LIMIT`. If next round has no HIGH, no effect and
  the token is not spent (reject at commit).
- Info: attacker needs nothing hidden; stake history is public on POWER_RESOLUTION.
- Balance: costs a confident gambler (p 0.6-0.8) about `(550p-200) - (350p-100)` = 20..60 points vs
  choosing HIGH; costs a cautious player 0. Roughly 2-8 JAM's worth, but only on bold players.
- Counterplay: shield; the target knows in prep and re-plans (RISK + Double Down is still legal under ADR-0021).
- Grief: gamblers get targeted more; bounded by per-target caps. Low.
- Presentation: icon = padlock on the top rung of a ladder; "Highest stake: Risk" / TR "En yüksek bahis: Risk".

### S2. Kör Saat / Blind Clock (perception, complexity S)

- Rule: target's phone hides the countdown bar and number for this question; the TV timer stays.
- Server: pure presentation flag in the `effects` the phone view receives (like `fogOptionId`); the
  window itself is unchanged. Server does not need to enforce it (a modified client only removes the prank).
- Info: none.
- Balance: low impact, estimated 5-10 speed points (inference; people hear and see the TV). Should be
  tested before any claim; honest placement: lowest-impact attack in the set.
- Counterplay: glance at the TV (by design). Shield.
- Grief: very low; good friendly default for parties with kids.
- Presentation: icon = clock with a slash; phone text "Clock hidden - watch the TV" / TR "Saat gizli - TV'ye bak".
- Also usable as the reduced-effects fallback for SHUFFLE/FOG instead of half-JAM (no time lost).

### S3. Buğu / Steam (perception + touch, complexity M)

- Rule: all four options on target's phone are steamed; swipe to clear each (about 1-2 s total).
- Server: presentation flag; no hidden info; clearing is client-only. Slightly stronger than FOG
  because it covers all options but can be cleared quickly.
- Balance: about 6-10 speed points; players with motor difficulties are hurt more, so
  `reducedEffects` converts to no-op and no token is refunded to the attacker? Open question: refund?
- Counterplay: shield; practise-wipe.
- Grief: moderate fatigue; max 1 per target per round already.
- Presentation: icon = fogged glass with finger trail; "Wipe to read" / TR "Silerek oku". Use a text
  hint, not blur alone, for low-vision users.

### S4. Komisyon / Cut (economy transfer, complexity M)

- Rule: 20 % of the target's next gain, at most 30 points, goes to the attacker instead of being burned.
  Lapses after 3 rounds like POINT_TAX. Attacker does not need to be right.
- Server: like `pointTax`: `target.powers.cut = { by, expires }`; consumed on first gain; component `CUT` pair
  (target -x, attacker +x), conserving points.
- Info: none.
- Balance: attacker +30 / target -30 = 60 relative swing at most, against POINT_TAX burning 25 % of the
  gain (mean gain 150 -> 37; 25 % of a 1500 jackpot = 375, uncapped today). Cut is smaller and capped,
  the transfer gives the attacker a reason to use it without being the only sufferer of a burn.
- Counterplay: shield; target can avoid gaining (not a choice), answer SAFE (less to take).
- Grief: highest of the seven because it enriches the attacker; mitigations are the 30 cap, the same
  token limits, no use when attacker is rank 1 (open question) and no use on a target with score 0.
- Presentation: icon = hand and coin; "20 % of your next gain goes to X (max 30)" / TR "Sonraki kazancının %20'si X'e gider (en fazla 30)".

### S5. Ayna Kalkanı / Mirror Shield (counter-tool, complexity S-M)

- Rule: a second kind of shield (1 per game, used instead of the normal shield on that hit): instead of
  absorbing the hit, it returns half-strength JAM, Blind Clock or Steam to the attacker. Cannot reflect
  Cut, Tax, Cap or Lockout, so economic effects never bounce.
- Server: choose in prep; the target is hit -> `resolveSabotage` branch. Attacker's token stays spent.
- Info: reflects a prank only; the attacker is never told in advance.
- Balance: ~4 speed points back to the attacker; mostly psychological (assumption: the Mirror stays hidden
  until it fires, which allows bluffing; confirm in the open questions).
- Grief: none (a defence). Hidden Mirror vs visible Shield matters (open question).
- Presentation: icon = mirror; "A hit bounces back" / TR "Saldırı sana değil, ona döner".

### S6. Işık Altında / Spotlight (social, complexity M)

- Rule: the target's name and committed stake tier are shown on the TV while the question is open.
- Server: needs `round.commitments[target].stake` to be broadcast before reveal. This is not an answer, but
  it is a currently hidden commitment, so a new view with an allow-list and a payload-scanner test is
  required (ADR-0008). Inference: it leaks confidence, so others might read "HIGH = knows it".
- Balance: no direct points. Social effect only; EV about 0, small second-order effect.
- Counterplay: SAFE hides nothing (SAFE is visible as SAFE); target may use Cover.
- Grief: embarrassment; low if tone is playful and only stake tier (never score or answer) is shown.
- Presentation: icon = spotlight cone; TV badge "Ali: HIGH" / TR "Işık Ali'de: Yüksek Bahis".

### S7. Süre Baskısı / Rush (time, complexity S)

- Rule: the target's speed bonus decays 1.5x faster this question (the window length is unchanged).
- Server: `speed = floor(speedMax x remaining / answerMs)` computed with a scaled elapsed value; only affects the
  bonus, never the correct/incorrect decision. Pure and testable.
- Balance: at a typical answer time halfway through the window the speed bonus drops from 50 to 25 (-25
  points, more than JAM's 8), but zero effect on a player who is correct and fast anyway. Test band: -15..-25.
  Because it can lead to panicked misclicks it is **the least aligned with principle 6**, so ship last.
- Counterplay: shield; answer fast.
- Grief: moderate. Reduced-effects: not applied.
- Presentation: icon = hourglass with an arrow; "Speed bonus fades faster" / TR "Hız puanı daha çabuk erir".

### 4.1 Sabotages considered and rejected
- **Decoy hint / misleading prompt on the target's phone** (GDD's "Noise"): can be read as fraudulent answer
  manipulation; GDD §7.6 forbids it.
- **Forced stake raise**: griefs weak players into losses; breaks "never unable to play".
- **Hide the question text**: effectively an unwinnable question; too strong versus the "never unable to play" rule.
- **Steal an opponent's joker**: permanent loss of agency; not a reversible effect.

---

## 5. Recommended shortlist (build first)

Risks: **R1 Cover (S), R2 Duel (M), R5 Pot (M)**.
Sabotages: **S1 Stake Cap (S), S4 Cut (M), S2 Blind Clock (S)**.

| Item | Why first |
|---|---|
| R1 Cover | Cheapest (a fee + loss waiver in one pure function). Makes the ladder approachable for casual players, EV-neutral at 50 %, no information involved. |
| R2 Duel | Highest TV drama and the only new tool where a trailing player can act on a named rival (comeback by agency, GDD §13.2); points are conserved. Directly inspired by Trivia Crack's steal-challenge (verified). |
| R5 Pot | Everyone can join; zero-sum, no multipliers, so it cannot interact with the 3x ceiling. Good for 5-8 player rooms. |
| S1 Stake Cap | Adds a decision-space attack with almost no client work (rides on the LOCKOUT ledger), targets boldness, which fits "owner likes gambling" without removing it. |
| S4 Cut | The only attack with an upside for the attacker besides pure harm; makes tokens more tempting. Needs red-team review for grief but is bounded by 30. |
| S2 Blind Clock | Safest, funniest and accessible; also solves the reduced-effects fallback (no time loss). |

Second wave: R3 Two-Step (needs cross-round state), R4 Trim (cheap but low novelty), S3 Steam, S5 Mirror,
S6 Spotlight. Later/maybe: R6 Backer, R7 Herd, S7 Rush.

### Implementation sketch common to all

1. Protocol: extend `COMMIT_PREP` (optional fields), `SABOTAGE_KINDS`, `PowerResolutionItem.kind`, view
   allow-lists; keep outbound schemas `.strict()`; add each new field to the payload-scanner fixtures.
2. Config: add fields (optional + default getters, as ADR-0021 did) so stored snapshots still parse;
   bump `GameConfig.version`.
3. Engine: validation in `checkCommit`, resolution in `resolveSabotage` / scoring components; every
   new rule gets a failing regression test first (property tests: scores never negative; points
   conserved for Duel/Pot/Cut; gain <= ceiling; refused commit spends nothing).
4. Clients: `PrepScreen` buttons disabled with a hint when a combination is illegal (as with Double
   Down), icon + text, never colour only; TV POWER_RESOLUTION line per item.
5. i18n: all strings in `packages/i18n` (tr and en); names above are proposals.
6. Docs: a new ADR (0022) when the owner chooses the set.

---

## 6. Open questions for the owner

1. **Item budget.** Are we OK with 6 new items in the shortlist, or one per category for the first release?
2. **Duel opt-in or not.** Auto-applies to the target (my proposal), or the target may decline for 20 points?
3. **Duel and Pot in small rooms.** Disable below 3 players (my proposal), or allow in 2-player games?
4. **Token types.** Keep one sabotage token for everything, or add a cheaper "prank" tier so low-impact
   items like Blind Clock cost less than economic ones like Cut?
5. **Cut and the leader.** Forbid the rank-1 player from using Cut to reduce snowballing? The rest of
   the system avoids rubber-banding, so this is the only place the question arises.
6. **Mirror: visible or hidden?** A hidden Mirror makes bluffing; a visible one is fairer but deters
   attacks. The existing Shield is hidden or visible? (I assumed hidden until it fires; please confirm.)
7. **Withdrawable commits.** ADR-0007 says committed powers cannot be withdrawn. Allow withdrawal until
   prep closes? It lowers regret but allows signalling.
8. **Prep length.** Extend `prepQuickMs` from 6 s to about 8 s when target-based items are on offer?
9. **Public stake before reveal.** Is revealing a stake tier early (Spotlight) acceptable under ADR-0008, or
   must committed stakes stay hidden until POWER_RESOLUTION?
10. **Ceiling and flat bonuses.** Flat bonuses (Two-Step, Herd, Backer) sit inside the 3x ceiling in my sketch.
    Do you prefer they sit outside it?
11. **Names and tone.** Are the Turkish/English names right for the target audience, and is "Cut" too
    aggressive for a family setting?
12. **Reduced-effects.** Should S2 Blind Clock replace half-JAM as the soft fallback for SHUFFLE/FOG?
13. **Evidence.** Do you want me to re-run the web research when the sandbox can fetch full pages
    (official power lists, reviews, postmortems)? Section 1 is thin on Trivia Crack's current rules.
