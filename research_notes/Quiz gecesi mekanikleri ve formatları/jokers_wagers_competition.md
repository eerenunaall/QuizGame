# Jokers, wagers, handicaps and competition mechanics at live paper-answer pub/bar quiz nights

> **Method caveat (read first).** In this session WebFetch could not resolve any host (geekswhodrink.com,
> wikipedia.org, towardsdatascience.com, lastcalltrivia.com, ripcitytrivia… all failed with ENOTFOUND, so the
> session's network allow-list blocks them). Every finding below comes from **web-search result summaries**,
> not from full-page reads. Where a search summary merged several sources I name the page the claim most likely
> comes from. Treat exact numbers as "reported by the snippet" and re-verify against the rule page before you
> encode them as product defaults. 17 search/fetch calls in total. Search date: 2026-11-14.

---

## Q1. Which mechanics do UK/Irish/US pub quizzes and quiz companies use, and exactly how are they scored?

### Takeaway
On paper, the dominant mechanic by a wide margin is the **joker**: one round per team per night, declared
before the round (or before marking), which doubles that round's points. US companies add **confidence wagers**:
Sporcle Live has teams assign 1–10 to questions, each value used once, and other hosts use slips worth 2/4/6.
Most US formats also end with a **final-question wager**: bet 0–N of your earned points, +N if right and −N if
wrong. UK pubs instead use a **separate jackpot/rollover round** (often 3 questions, all must be right) and
**booby prizes**. I found no evidence that Geeks Who Drink uses point-wagering. Its documented levers are a joker
plus fixed double-value rounds. The "GWD-style 2/4/6 wagering" in the brief is really a generic US bar-trivia
pattern.

### Cited findings: the catalogue

Each entry covers how it works, when it is played, how the host announces it, the exact scoring rule, what it
needs beyond paper, pitfalls, and how common it is.

#### 1. Joker / double-points round (one per team per night)
- **How it works:** a team nominates one round, and all points it scores in that round count double. Some quizzes
  allow one or two joker rounds, and some multiply by more than ×2. Teams strong on a subject "improve their
  chances with a good joker round, but risk wasting the joker if the questions are unexpectedly difficult". —
  [Wikipedia: Pub quiz](https://en.wikipedia.org/wiki/Pub_quiz) (via search summary)
- **When it is played:** usually chosen **before the quiz starts**, and "some rounds may be excluded (usually the
  first)". — [Wikipedia: Pub quiz](https://en.wikipedia.org/wiki/Pub_quiz). Some charity packs only require the
  card to be played "before the round is marked". —
  [Prospect Hospice quiz pack inc. joker (2019)](https://www.prospect-hospice.net/wp-content/uploads/2019/01/Pub-quiz-pack-inc.-joker.pdf).
  Another rule: it "must be declared before that round begins, and cannot apply retrospectively". —
  [ukcalculator pub quiz score calculator](https://ukcalculator.com/pub-quiz-score-calculator.html)
- **Paper implementation:** a printed joker card handed in with the sheet
  ([Marie Curie joker cards](https://www.mariecurie.org.uk/document/christmas-quiz-joker-cards-small);
  [NDCS joker card PDF](https://www.ndcs.org.uk/media/1419/joker-card.pdf)), or a "Joker box on the answer sheet
  that must be ticked before marking". —
  [Alzheimer's Research UK Quizmaster Pack (2018)](https://www.alzheimersresearchuk.org/wp-content/uploads/2018/10/TMQ-Digital-Quizmaster-Pack-web.pdf)
  (via search summary)
- **Geeks Who Drink (US):** the quiz has 8 rounds of 8 questions, teams of up to 6, and most rounds are worth 8
  points. The music round (round 2) and round 8 are worth 16. **One round per game can be jokered**, which doubles
  that round, a 16-point round included. The team circles the joker icon on the answer sheet. —
  [Johnny Goodtimes, "Geeks Who Drink Rules Week" (2011)](https://johnnygoodtimes.com/2011/07/geeks-who-drink-rules-week/);
  [Do512 GWD listing](https://do512.com/events/weekly/mon/free-geeks-who-drink-pub-quiz);
  [The QG blog, GWD at Clock Bar](https://www.theqg.com/blogs/news/geeks-who-drink-trivia-at-clock-bar) (via search
  summary; old source, re-verify)
- **Redtooth (UK quiz supplier), "The Big Weekly Quiz":** the joker comes into play **after round 2**. A team can
  play it to double the points it scores in that round. One Redtooth sheet adds a cross-week rule: if you play your
  joker, "you won't be able to use a joker next time you play". —
  [Redtooth: The Big Weekly Quiz](https://www.redtoothquiz.co.uk/products/the-big-weekly-quiz);
  [Redtooth brochure PDF](https://www.redtoothbrochure.com/files/Redtooth_Quiz_Download.pdf)
- **Variant with a penalty:** a commercial pub-quiz board game uses a joker chip where each correct answer
  counts double but **each wrong answer is −1**. —
  [Board game matcher: Ridley's Games Room Pub Quiz](https://boardgamematcher.com/game/ridleys-games-room-pub-quiz)
- **Turkey:** Turkish quiz-night explainers list "joker/çift puan hakları, bonus sorular ve eşitlik bozma soruları"
  (joker/double-points rights, bonus questions and tie-break questions) as normal components. Scoring is usually 1
  point per correct answer, picture or music rounds may give 2, and there is no penalty for a wrong answer. Nights
  run 4–6 rounds of 8–12 questions. —
  [Firsat.me blog: Quiz Night](https://www.firsat.me/Blog/quiz-night-sorularin-kahkahalarin-ve-sessiz-icsel-yolculuklarin-gecesi);
  [Firsat.me: Quiz Night oyun saatleri](https://www.firsat.me/Blog/quiz-night-oyun-saatleri-ne-zaman-baslar-nasil-akar-nerede-eglenilir)
  (generic blog, not a rule page)
- **Advice:** "don't play your joker on general knowledge; save it for the round your team is strongest in". —
  [doquizzes.com: Pub Quiz Tips](https://doquizzes.com/blog/pub-quiz-tips-how-to-win-trivia-night).
  A joker is called "the cheapest way to keep a struggling table in the game until the end". —
  [Orangejelly: 25 Pub Quiz Formats](https://www.orangejelly.co.uk/guides/quiz-night-ideas) (via search summary)
- **Common pitfalls (from the above):** teams forget to declare or tick the box, which causes arguments after
  marking. Hence the "before the round / before marking" rule. Some teams try to joker a round retroactively. The
  joker is wasted on a round that turns out hard.

#### 2. Confidence / point-assignment wagers per question (the "2/4/6" family)
- **Sporcle Live:** 10 regular questions, a four-part themed Mystery Round and a Final Question. "You wager on
  every answer by giving it a point value from 1 to 10. **Each value can be used only once per game.**" —
  [Sporcle blog: What Is Sporcle Live? (2020)](https://www.sporcle.com/blog/2020/05/what-is-sporcle-live/);
  [Sporcle blog: What is Bar Trivia? (2015)](https://www.sporcle.com/blog/2015/02/bar-trivia-what-is-sporcle-live/)
- **2/4/6 then 5/7/9 (US university and bar format):** each round has three questions. In the first half the
  wagers are 2, 4 and 6, in the second half 5, 7 and 9, and **each value is used only once per round**. If you put
  6 on Q1, only 2 and 4 remain. Other hosts use **1/3/5** in rounds 1–3 and **2/4/6** in rounds 4–6. Teams write
  the team name, the answer and the point value on one slip per question. Answers are final once submitted. —
  [Boston University MET Trivia Night How-to-Play (2021)](https://www.bu.edu/met/files/2021/04/MET-Trivia-Night-How-to-Play.pdf);
  [Big Trophy Trivia rules](http://www.bigtrophytrivia.com/rules);
  [Quality Trivia: The Rules](https://qualitytrivia.com/the-rules/);
  [Bar Trivia Live: The Rules](http://www.bartrivialive.com/how-to-play.html) (via search summary; which host uses
  which set is not separable from the snippet)
- **How it is scored:** a correct answer earns the value the team assigned and a wrong answer earns 0. In most
  per-question variants, a wrong answer loses nothing. Only the final wager is subtractive.
- **Beyond paper:** one slip per question, or a sheet with a "points" column. The host must check that no value
  was reused.
- **Pitfalls:** reused values. A Metafilter host thread describes a round where teams assign point values to
  questions as they choose, which they framed as "a strategic choice rather than theft". —
  [Ask Metafilter: Help me make an awesome trivia night](https://ask.metafilter.com/203591/Help-me-make-an-awesome-trivia-night)

#### 3. Final-question wager (Jeopardy-style)
- **Sporcle Live:** teams wager points they have already earned. Older pages give **0–20**, a 2020 page gives
  **up to 15**. A right answer adds the wager and a wrong answer subtracts it. One venue listing says the wager is
  made **knowing only the category, before the question is read**. —
  [Sporcle: What Is Sporcle Live? (2020)](https://www.sporcle.com/blog/2020/05/what-is-sporcle-live/);
  [Detroit Shipping Co. Sporcle LIVE listing (2019)](https://www.detroitshippingcompany.com/events-calendar/2019/11/11/sporcle-live-trivia-kcmmy).
  **The cap conflicts between Sporcle pages (20 vs 15)**, so the format probably changed around 2020. A 2026 post
  confirms the game still ends with a Final Question where teams "can bet points and risk losing them". —
  [Sporcle: There's No One Right Way to Play Trivia (Apr 2026)](https://www.sporcle.com/blog/2026/04/theres-no-one-right-way-to-play-trivia/)
- **Other variants found:**
  - Pick a fixed stake of 2, 4, 6, 8 or 10.
  - Bet 0–15 **after** the question is read.
  - A wrong answer loses the whole stake. Some hosts make it lose **half** the stake.
  - If a team bets nothing, a **10% automatic stake** applies. Another host uses the lowest remaining wager value
    when an answer is handed in without a bet.
  - Some hosts **announce all teams' totals before the final question**.

  — Search summary over [Quizado: Bar Trivia rulebook](https://quizado.com/bar-trivia-rulebook),
  [Quizado: How to play trivia](https://quizado.com/how-to-play-trivia),
  [Gift of Adoption trivia instructions (2013 .doc)](https://giftofadoption.org/wp-content/uploads/2022/04/Trivia-InstructionsFinal2013.doc),
  [Straight Dope boards](https://boards.straightdope.com/t/tonights-1000-trivia-question/582054?page=2),
  [Rip City Trivia format](https://ripcitytrivia.squarespace.com/format/gameformat). Per-host attribution was not
  recoverable from the summary, so treat these as "variants that exist", not company-specific rules.
- **Strategy (the Towards Data Science analysis, title only):** with confidence p, wager the maximum (10) if
  p > 1−p, otherwise the minimum (2). —
  [Towards Data Science: How to wager at the final questions in bar trivia](https://towardsdatascience.com/how-to-wager-at-the-final-questions-in-bar-trivia-594a1d746bb2)
  (page blocked; claim from snippet only)
- **Strategy heuristic:** trailing teams should wager everything, teams that are tied or slightly ahead should
  wager carefully, and a team with a big lead should "wager just enough to maintain lead even if you miss". —
  [Superglobalcalculator: Trivia Night Score Estimator](https://superglobalcalculator.com/calculators/games/trivia-team-score/)
- **Pitfalls:**
  - Ambiguity over whether a team can bet more than it holds. Sporcle says "points they have already earned".
  - Unreadable wager numbers on paper.
  - Teams forget to write a wager, hence the default-stake rules.
  - Arguments on "unsolvable" final questions:
    [Straight Dope: our trivia final question was essentially unsolvable](https://boards.straightdope.com/t/our-trivia-final-question-last-night-was-essentially-unsolvable/634991?page=2).

#### 4. "All or nothing" / killer round
- **How it works:** a team scores **double points if every answer in the round is correct, and zero for the
  whole round if any one is wrong**. The blogger reports they "often lost as we'd gamble on one answer", and
  argues jokers are fairer because they double what you earn rather than risk what you've banked. —
  [James Potts blog: How To Write A Pub Quiz? (Jan 2026)](https://jamespottsblog.wordpress.com/2026/01/04/how-to-write-a-pub-quiz/)
  (via search summary)
- **Commonness:** I found it in one blog only, so it is less common than the joker.

#### 5. Jackpot / rollover round (UK) — the paper "all-correct bonus"
- **How it works:** "A separate round of questions (usually 3) at the end of the quiz each week. If no team gets
  all answers correct more money is added for the following week." The jackpot may be capped by local gaming
  regulations. — [Wikipedia: Pub quiz](https://en.wikipedia.org/wiki/Pub_quiz);
  [Paul's Quiz: Running a Pub Quiz](https://www.paulsquiz.com/quiz-advice-and-tips-mainmenu-199/203-trivia-quiz-resources/41-quiz-advice/2276-running-a-pub-quiz)
- **Variants:**
  - A sealed number in an envelope that every team guesses on paper each week. It stays the same until someone
    guesses it. — [Paul's Quiz](https://www.paulsquiz.com/quiz-advice-and-tips-mainmenu-199/203-trivia-quiz-resources/41-quiz-advice/2276-running-a-pub-quiz)
    (via summary)
  - Redtooth's "Lucky 13", a weekly rollover jackpot.
  - Redtooth's "Red or Black": predict the colour of the next 7 cards turned by the QM, and one wrong prediction
    eliminates you. — [Redtooth: Lucky 13](https://www.redtoothquiz.co.uk/products/lucky-13)
- **Regulatory pitfall:** Orangejelly advises keeping a rolling jackpot jar **under £50 to avoid gambling
  implications**. — [Orangejelly: How to Run a Pub Quiz](https://www.orangejelly.co.uk/guides/quiz-night-101)
  (about a year old)

#### 6. Spot prizes / first-correct-hand-in
- "In some variants, the first team to hand in the correct answer wins either a spot prize or additional points
  to their total score." — [Wikipedia: Pub quiz](https://en.wikipedia.org/wiki/Pub_quiz) (via summary)
- **GWD:** a Yelp listing says bonus questions through the evening can win free pints, separately from the score.
  — [Yelp: GWD Oklahoma City](https://www.yelp.com/events/oklahoma-city-geeks-who-drink-pub-trivia-night)
- **Raffle-style halfway prize:** "Halfway through the evening have someone come and select the lucky winning
  number from a hat." — search summary attributing to
  [pub-quiz-questions.com: How to Run a Quiz Night (2018)](https://pub-quiz-questions.com/2018/04/21/how-to-run-a-quiz-night/)

#### 7. Wooden spoon / last-place prize
- Orangejelly suggests a booby prize for last place, "a pickled egg or a wooden spoon". —
  [Orangejelly: How to Run a Pub Quiz](https://www.orangejelly.co.uk/guides/quiz-night-101)
- An example budget: £40 bar tab for 1st, £20 for 2nd and a **£10 tab for the wooden spoon**. Also "a bag of
  cheap crisps or a wooden spoon… keeps the 'fun' teams coming back". Another format is a round scored in reverse,
  or a bonus for last place, "softens the bottom of the table and gets a laugh". —
  [Orangejelly: Quiz Night Ideas, 25 formats](https://www.orangejelly.co.uk/guides/quiz-night-ideas) (via summary)

#### 8. Team-name bonus point
- "A bonus point for the best team name, voted on or decided by the quizmaster… costs nothing and is the reason
  people put effort into their names." —
  [Orangejelly: Quiz Night Ideas](https://www.orangejelly.co.uk/guides/quiz-night-ideas) (via summary)

#### 9. Mid-game leaderboard reveal
- UK guides put a break halfway through for food and drink orders, when rounds are marked. —
  [Orangejelly: How to Run a Pub Quiz](https://www.orangejelly.co.uk/guides/quiz-night-101)
- US final-wager hosts "announce the point totals for ALL teams before asking the Final Question" so teams can
  size their wagers. — search summary (rules pages listed under #3)
- In a patented trivia-game design, the visible leaderboard is the input players use to choose wager size, and
  far-behind players are expected to bet more. —
  [Justia patent 20070057470](https://patents.justia.com/patent/20070057470)

#### 10. Steal / pass, head-to-head duels, pick-your-category jokers, crowd-voted bonuses
- **Steal:** the only steal rule I found is from a digital party quiz, not a paper pub quiz. A player skips the
  question and names "a mark". If the thief is wrong, the steal backfires and the target gets double the round
  value. — [MAM Digital: Free Quiz Game for Teams](https://www.mamdigital.co.uk/free-quiz-game)
- **Head-to-head between tables, pick-your-category jokers and crowd-voted bonuses:** **no paper-quiz source
  found** (see Gaps). The closest crowd-voted mechanic is the team-name vote in #8.

#### 11. Sabotage (FLAG: the owner has already rejected "block the leader" and a whispered 50/50)
- **No standard bar-trivia format with steal or sabotage turned up.** Sabotage appears in **card-based party
  games**:
  - TRIVIA HEADS! (Kickstarter): "lifeline, sabotage, and point cards" earned by answering. —
    [Kickstarter: TRIVIA HEADS!](https://www.kickstarter.com/projects/triviaheads/trivia-heads-a-quiz-party-game-of-skill-and-sabotage)
  - Trivia Sabotage (itch.io): hold up to 2 cards per round to remove wrong answers, protect yourself, change
    scoring or make an opponent's question harder to read, but "sabotage never changes the correct answer". —
    [itch.io: Trivia Sabotage](https://shadowselfgames.itch.io/trivia-sabotage)
- **Bar fair-play norms go the other way:** "no cell phones, no phone-a-friend or ask-a-bartender, no sneaking a
  peek at the answers of the team next to you." —
  [Sporcle: What To Expect At Trivia Night (2019)](https://www.sporcle.com/blog/2019/06/what-to-expect-at-trivia-night/)
- **Evidence on whether sabotage is fun on paper:** none either way from venues. The evidence of absence
  (no company rule page or venue listing found with it) suggests real paper nights don't use it.

#### 12. Fixed-value rounds as structural handicap (not targeted catch-up)
- GWD's double-value music round and 16-point round 8 (questions worth 1–4 points in the bar version) keep late
  swings possible for every team. — sources under #1 (GWD)
- Picture/music rounds worth 2 points each in Turkish formats. —
  [Firsat.me](https://www.firsat.me/Blog/quiz-night-sorularin-kahkahalarin-ve-sessiz-icsel-yolculuklarin-gecesi)

### Inferences
- **Commonness ranking** (my synthesis from how often each turns up across the sources): joker ≫ final wager (US)
  ≈ jackpot/rollover (UK) > per-question confidence values (US) > spot prizes / bonus pints > booby prize >
  team-name bonus > killer round > anything steal/duel/sabotage (not found on paper).
- **GWD:** I found no wager round. Its documented catch-up levers are the joker plus fixed double-value rounds. The
  "2/4/6" pattern belongs to Sporcle-style and regional US hosts.

### Gaps
- Full GWD, Trivia Mafia, King of the Pub, Quizland and Brainstorm rule pages could not be read, because WebFetch
  was blocked. Trivia Mafia's format was not found at all. A search listing only says it runs 34 venues in 6
  cities, Minneapolis-based ([trivianearme.net](https://trivianearme.net/blog/biggest-bar-trivia-companies)).
  King of the Pub and Quizland: nothing found.
- No Istanbul venue rule sheet with wagers was found. Ticket pages
  ([Biletix Kadıköy Quiz Night](https://www.biletix.com/etkinlik/3TGK6/TURKIYE/tr),
  [Tayfa İstanbul](https://www.tayfaistanbul.com/service-page/quiz-night),
  [TripAdvisor Istanbul Trivia Night](https://www.tripadvisor.com/AttractionProductReview-g293974-d32699172-or30-Istanbul_Trivia_Night_English_and_Turkish_Pub_Quiz-Istanbul.html))
  give only team sizes (Kadıköy: 2–10 people), capacity (Beyoğlu: max 50) and age limits (18+).
- No paper-quiz source was found for head-to-head table duels, pick-your-category jokers, crowd-voted bonuses,
  explicit trailing-team handicaps (for example "bottom 3 get +2"), or the "bonus point if you get all right"
  round. The killer round and the jackpot round are the closest documented relatives.

---

## Q2. Which mechanics keep trailing teams engaged, and which create runaway leaders or arguments?

### Takeaway
I found no measured data. Host guides and strategy writing agree on the levers that keep a trailing team alive:
a joker, a late variable-value round, a final wager with visible standings, and a booby prize. The mechanics they
flag for arguments are retroactive jokers, half points and all-or-nothing rounds.

### Cited findings
- The joker is "the cheapest way to keep a struggling table in the game until the end". —
  [Orangejelly: Quiz Night Ideas](https://www.orangejelly.co.uk/guides/quiz-night-ideas)
- Final-wager strategy explicitly assumes trailing teams bet everything while leaders bet defensively, so the
  wager is the designed catch-up valve. —
  [Superglobalcalculator](https://superglobalcalculator.com/calculators/games/trivia-team-score/);
  [Justia patent 20070057470](https://patents.justia.com/patent/20070057470)
- Leader runaway shows up in TV formats too. Master Minds ends a round once trailing players mathematically cannot
  catch up. — [Wikipedia: Master Minds](https://en.wikipedia.org/wiki/Master_Minds_(game_show)) (TV, transferable
  idea only)
- **Arguments:**
  - "Keep scoring simple… one point per correct answer, since half points lead to arguments." —
    [Orangejelly](https://www.orangejelly.co.uk/guides/quiz-night-ideas) / [Pubquizine: Running a pub quiz](https://pubquizine.co.uk/running-a-pub-quiz/)
    (via summary)
  - Jokers must be declared before the round or before marking, to stop retroactive claims. —
    [ukcalculator](https://ukcalculator.com/pub-quiz-score-calculator.html);
    [Prospect Hospice pack](https://www.prospect-hospice.net/wp-content/uploads/2019/01/Pub-quiz-pack-inc.-joker.pdf)
  - Killer rounds wipe out a whole round on one guess, and a blogger prefers jokers as fairer. —
    [James Potts blog (2026)](https://jamespottsblog.wordpress.com/2026/01/04/how-to-write-a-pub-quiz/)
  - "Unsolvable" final questions spark complaints, because the wager amplifies them. —
    [Straight Dope](https://boards.straightdope.com/t/our-trivia-final-question-last-night-was-essentially-unsolvable/634991?page=2)
- **Strong-team advantage of jokers:** "Strong teams can gain an edge with a good joker". —
  [Wikipedia: Pub quiz](https://en.wikipedia.org/wiki/Pub_quiz). A joker multiplies whatever a team scores, so it
  amplifies skill as much as it rescues a weak team.
- **Bottom-of-table retention:** the wooden spoon and booby prizes "keep the 'fun' teams coming back"; a
  reverse-scored round or a last-place bonus "softens the bottom of the table". —
  [Orangejelly: Quiz Night Ideas](https://www.orangejelly.co.uk/guides/quiz-night-ideas)

### Inferences
- **Joker:** in absolute points it favours strong teams (double of 7 beats double of 4). What it gives a trailing
  team is variance: a weak team that jokers its niche round can jump. It does not shrink the gap on average.
- **Final wager with standings shown:** the only mechanic with a built-in comeback for every team still within
  the cap. It needs a cap tied to points held, or a fixed menu, to stop a leader being overtaken by luck alone.
- **Per-question 2/4/6 values:** reward calibration rather than raw knowledge, and the downside is mild (a wrong
  answer scores 0). That makes them low-argument.
- **Wooden spoon, team-name bonus, spot prizes:** engage people who are out of contention without distorting the
  main table.

### Gaps
- No quantitative study, survey or host-reported retention figures were found on any mechanic.
- No Reddit r/pubquiz or r/trivia threads came up in search, so community sentiment is from blogs and guides only.

---

## Q3. Which are trivial for a host to run from a tablet and compute automatically (score from a marking grid)?

### Takeaway
Every documented mechanic reduces to a per-team flag or number plus a deterministic formula over the grid of
correct and wrong answers. The joker, 2/4/6 values, final wager, killer round and jackpot need no host judgement
at scoring time. Team-name bonus, spot prize and wooden spoon are a single manual award.

### Cited findings (the exact rules the formulas come from)
- **Joker:** round score × 2 if the flag was set before marking. GWD and Redtooth use exactly ×2, while
  "otherwise multiplied" variants exist. — [Wikipedia: Pub quiz](https://en.wikipedia.org/wiki/Pub_quiz);
  [Redtooth: The Big Weekly Quiz](https://www.redtoothquiz.co.uk/products/the-big-weekly-quiz). Optional
  constraints: excluded rounds (usually round 1); available only after round 2 (Redtooth); a penalty variant
  where each wrong answer in the joker round is −1 ([Ridley's](https://boardgamematcher.com/game/ridleys-games-room-pub-quiz)).
- **Value assignment:** Σ over correct answers of the assigned value. The validation rule is that each value in
  {1..10} is used once per game (Sporcle), or each of {2,4,6} once per round (BU). —
  [Sporcle](https://www.sporcle.com/blog/2020/05/what-is-sporcle-live/);
  [BU MET PDF](https://www.bu.edu/met/files/2021/04/MET-Trivia-Night-How-to-Play.pdf)
- **Final wager:** the team chooses w with 0 ≤ w ≤ min(cap, current score). Right means +w, wrong means −w (or −w/2
  in some variants), and no wager means a default (10% or the lowest value). — sources under Q1 #3
- **Killer round:** if every answer is correct, 2 × the round score; otherwise 0. —
  [James Potts blog](https://jamespottsblog.wordpress.com/2026/01/04/how-to-write-a-pub-quiz/)
- **Jackpot:** if every jackpot question is correct, the team wins the pot; otherwise it rolls over. —
  [Wikipedia: Pub quiz](https://en.wikipedia.org/wiki/Pub_quiz)

### Inferences
- **Fiddliest part on paper:** the host has to read declared flags (joker box, wager numbers) correctly and in
  time. In a tablet product these become controller intents locked server-side before the round or question
  reveal. That would fix the forget-to-declare and retroactive-joker arguments documented above.
- **Not grid-computable:** the team-name vote, spot prizes and "most creative wrong answer" style awards need a
  host tap or an audience vote.
- **Steal and duels:** they need cross-team state (who targets whom), which is why they don't appear in paper
  formats. They would require a TV/phone flow, and the rejected "block the leader" falls in this class.

### Gaps
- No source documents how commercial host apps (Sporcle, GWD, Redtooth) actually enter jokers and wagers. That is
  outside what could be fetched.

---

## Q4. What do quiz hosts and quiz-writing communities recommend and warn against?

### Takeaway
They recommend:
- one joker per team, declared before the round or before marking, often with the first round excluded
- simple 1-point scoring and no half points
- a fixed, short format (90 minutes, 5–6 rounds, a halfway break for marking)
- cheap fun prizes: a wooden spoon, best team name, spot prizes
- a capped jackpot (under £50 in the UK)

They warn against:
- half points
- unannounced or retroactive rule changes
- all-or-nothing rounds that wipe out banked points
- unbounded gambling-like jackpots
- any interference between tables

### Cited findings
- **Fixed format:** "same night every week with a fixed 90-minute format", 5–6 rounds, a halfway break, and a
  jackpot jar capped under £50 "to avoid gambling implications". —
  [Orangejelly: How to Run a Pub Quiz](https://www.orangejelly.co.uk/guides/quiz-night-101)
- **Pace:** read each question twice, and give a 30-second warning before moving on. —
  [Orangejelly / Pubquizine](https://pubquizine.co.uk/running-a-pub-quiz/) (via summary)
- **Joker timing:** declare before the round, never retrospectively. —
  [ukcalculator](https://ukcalculator.com/pub-quiz-score-calculator.html)
- **Joker scarcity:** limit to one per team per night ("Most quizzes allow only one Joker per team per quiz
  night"). — search summary over [Wikipedia](https://en.wikipedia.org/wiki/Pub_quiz) and
  [Paul's Quiz](https://www.paulsquiz.com/quiz-advice-and-tips-mainmenu-199/203-trivia-quiz-resources/41-quiz-advice/2276-running-a-pub-quiz)
- **Anti-interference norm:** no peeking at the next table and no phoning a friend. —
  [Sporcle (2019)](https://www.sporcle.com/blog/2019/06/what-to-expect-at-trivia-night/); anti-cheating host guide
  [RoundKit: How to Stop Cheating at a Pub Quiz](https://roundkit.runriva.com/blog/how-to-stop-cheating-at-pub-quiz)
- **One house's perspective:** "There's no one right way to play trivia". —
  [Sporcle (Apr 2026)](https://www.sporcle.com/blog/2026/04/theres-no-one-right-way-to-play-trivia/)

### Inferences
- **For this product:** the venue-proven set is joker, value assignment, final wager, jackpot/all-correct bonus,
  team-name bonus, wooden spoon, spot prize and a halfway leaderboard. All are additive and none targets another
  team. That fits the owner's rejection of "block the leader".
- **Sabotage:** there is no venue evidence for it, only party card games. If anything sabotage-like is added, the
  least risky shape seen is self-protective or self-wagering (a joker, a wager) rather than opponent-directed.

### Gaps
- No Reddit host discussion was retrievable.
- No source quantified how many UK pubs run jokers versus jackpots versus neither.
- No Turkish venue rules beyond a generic blog.
- Re-run with geekswhodrink.com, sporcle.com, wikipedia.org and reddit.com allowed, to confirm the exact current
  caps (Sporcle final 15 vs 20; GWD round-8 values).
