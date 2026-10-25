# Question slice C: cinema-tv, gaming, business-economy, fandoms

Status: PARTIAL. 277 verified questions in `seed/gusto/questions.C.tr.jsonl`; no category reaches 50 or 100.
The web-search budget per turn (about 200 calls shared by all agents) is the limit, not the writing.

## Counts per category

| Category | Questions | Easy / Medium / Hard |
|---|---|---|
| breaking-bad | 63 | 3 / 34 / 26 |
| game-of-thrones | 35 | 11 / 15 / 9 |
| harry-potter | 31 | 12 / 14 / 5 |
| gaming | 26 | 5 / 12 / 9 |
| better-call-saul | 24 | 9 / 10 / 5 |
| the-office | 24 | 6 / 15 / 3 |
| how-i-met-your-mother | 22 | 9 / 10 / 3 |
| cinema-tv | 20 | 7 / 9 / 4 |
| warhammer | 17 | 6 / 9 / 2 |
| business-economy | 15 | 2 / 9 / 4 |

Overall about 25 percent easy, 50 percent medium, 25 percent hard. The easy share is below target for
breaking-bad (the easy items that fit were exact duplicates of the old demo bank), gaming and business-economy.
Correct-answer positions are rotated evenly inside each category. `externalId` is `gusto-c-<category>-NNN`,
`authorType` AI_ASSISTED.

## Evidence standard actually used

- `WebFetch` is blocked (`en.wikipedia.org` is refused by the egress proxy), so no page was read in full.
- Evidence is the `WebSearch` result: the reputable-domain result list plus the text the search returned. Searches
  were restricted to `en.wikipedia.org`, `britannica.com`, `guinnessworldrecords.com`, `netflix.com` and
  `breakingbad.fandom.com`. A fact was kept only when the returned text stated it. A fact the text contradicted, did not
  mention, or only half supported was dropped or reworded.
- Verification was by cluster: one search on an overview or episode-guide page for several facts. `sources` hold the
  pages returned by those searches with `retrievedAt` 2026-10-20 (breaking-bad) or 2026-10-25 (the rest). For many
  rows the second source is a related page of the same host family, so a human sampler should check the hard
  fandom details first.
- Dropped for lack of support: the Riverside script location, "A1A Car Wash", Walt's exact meth purity, any
  "first appears in" claim that the text did not state, Ranjit as limo driver, Robin's channel name, the Stardew
  Valley author name, Minecraft's sale price, the Dumbledore ring detail that the text only half stated, and every
  figure that changes over time (copies sold, box office, the current Emmy tally).

## Reviewer round R1 (docs/question-slices/REVIEW-QUEUE.md)

Five breaking-bad rows were flagged and are fixed in this version: the Gale / "Sunset" explanation (now says
the dedication is seen in "Gliding Over All"), "Güney Amerikan argosu" (now the American South), the machine gun
question (now tied to the flash-forward opening of "Live Free or Die"), the "Mythbusters Jr." wording (now
MythBusters), and the Walter Jr. question (dropped, unverifiable). The Whitman-poet question was also dropped to
shrink the "Leaves of Grass" cluster to two rows. Patterns the reviewer lists as weak (answer cue in the stem,
lazy distractors, two defensible answers, wrong episode attribution) were checked against every new row.

## Audit of the old questions (500 rows read in round 1)

`seed/questions.tr.jsonl`, `seed/demo/questions.base1.tr.jsonl`, `questions.cult.tr.jsonl`, `questions.cult2.tr.jsonl`:
all DEV_SEED, unverified, no sources, none edited. Findings: many trivial or childish rows (Woody, Tom and Jerry,
Pac-Man's colour), answers cued by the stem, duplicates across `cult` and `cult2`, fan-only details, time-sensitive
claims (largest economies, "0 Emmys"), arguable "firsts" (Pong vs Computer Space, first sound film). Decision:
0 kept as written; topics that survive are rewritten in the new set; the rest stay in the old demo files, which
are not launch material.

## Dry run

```
pnpm --filter @quizparty/scripts run question import ../seed/gusto/questions.C.tr.jsonl --dry-run
[dry run] 277 rows: 277 CREATED
automatic review of the new questions: 277 -> 264 PASS / 13 REVIEW / 0 REJECT
batch warning: CORRECT_LONGEST_BIAS
```

The 13 REVIEW rows are all `SIMILAR_QUESTION` (or one option-punctuation hint): they resemble the old demo rows
they replace and clear once those are retired. `CORRECT_LONGEST_BIAS` is a batch hint (the correct option is
the longest in 66 of 187 eligible rows, mostly names and phrases); fix by padding wrong options in the next pass.
A profanity filter false positive on the title "Battle of the Bastards" and on a poet's name were rephrased.

## Still open

Every category is below 50. Next pass needs fresh search budget for: game-of-thrones (seasons 2 to 7 arcs,
house words, locations, Valyrian lore), harry-potter (book plots, spells, creatures, Quidditch history, films
by film), better-call-saul and breaking-bad (cast beyond the leads, season-by-season arcs), the-office and
how-i-met-your-mother (episode guides by season), warhammer (Imperium, Primarchs, Age of Sigmar, Black Library),
cinema-tv (directors, studios, TV awards, Turkish TV history), gaming (indie, esports, studios, Turkish scene),
business-economy (founders, brands, Turkish economy dates, concepts). Easy rows that do not collide with the old
demo bank are the main gap.
