# Question slice C: cinema-tv, gaming, business-economy, fandoms

Status: PARTIAL. Only `breaking-bad` is delivered (65 verified questions). The other nine categories of this
slice (cinema-tv, gaming, business-economy, game-of-thrones, harry-potter, warhammer, better-call-saul,
the-office, how-i-met-your-mother) have 0 new questions because verification could not be finished.

## Why partial

Verification needs web search. The `WebSearch` tool is capped at 200 calls per turn, shared by every agent
in the turn. The cap was hit while `breaking-bad` was being verified, and every later call returned
"web search budget is used up". Nothing may be kept unverified, so no question was written for the other
categories and none was padded in. Re-run this slice in a fresh turn (or with
`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` raised); the builder approach below is repeatable.

## Evidence standard actually used

- `WebFetch` was blocked (`en.wikipedia.org` is refused by the egress proxy), so no page was read in full.
- Evidence is the `WebSearch` result: reputable-domain result list plus the text the search returned for
  it. Searches were restricted to `en.wikipedia.org`, `britannica.com`, `guinnessworldrecords.com`,
  `netflix.com`, `emmys.com` and `breakingbad.fandom.com`. A fact was kept only when the returned text stated it.
- Facts the search text contradicted or did not mention were dropped or reworded (for example the
  "A1A Car Wash" claim, the "99.1 percent" purity figure, the Riverside script location which only one
  fan-wiki page supported, and the episode where Gus first appears).
- `sources` hold the pages returned by those searches (Wikipedia episode/character/award pages, Guinness
  record page, Britannica, the Breaking Bad fandom wiki) with `retrievedAt` 2026-10-20. Where two independent
  hosts were not available for a non-obvious fact, the question relies on a Wikipedia article plus a
  second page from the same family; a human sampler should spot-check those first (hard fandom details).

## Audit of the existing questions (500 rows read)

Files: `seed/questions.tr.jsonl` (60 rows in this slice: cinema-tv, gaming, business-economy),
`seed/demo/questions.base1.tr.jsonl` (90), `seed/demo/questions.cult.tr.jsonl` (175) and
`seed/demo/questions.cult2.tr.jsonl` (175). All are `DEV_SEED`, unverified, with no sources. None were edited.

Findings:

1. Many are trivial or childish: Woody is the cowboy toy, Tom is a cat, Pac-Man is yellow, Mario is a plumber,
   "who founded Facebook/Amazon/Microsoft", basic definitions (faiz, vergi, maas).
2. Answer cued by the question: the alias taken from a physicist is Heisenberg, the snake-house founder is
   Slytherin, Gus's chicken chain sells chicken, the "Kis Geliyor" family words.
3. Duplicates across `cult` and `cult2` and within a file: Stark/Lannister sigils asked twice, "who plays X" for
   nearly every cast member, one Primarch-per-legion question per legion, one Hogwarts house founder per house.
4. Fan-only or low-value details: exact episode counts, a minor character's relative, a car brand, a nail-salon
   office, Primarch lists.
5. Time-sensitive or arguable: largest/second-largest economy, "Better Call Saul won 0 Emmys" (can change),
   first commercial video game (Pong vs Computer Space), first sound film (The Jazz Singer is only the first
   feature with synchronised dialogue).
6. Fine in substance (rewritten into the new bank where it belongs to a delivered category): the Emmy years,
   the Ozymandias poem, Face Off, Gray Matter, El Camino, Jesse's planned fate.
7. Turkish is mostly correct. Option sets sometimes mix English and Turkish titles.

Decision for the delivered category (breaking-bad, 50 old rows in cult and cult2):
0 kept as written, about 20 topics rewritten into the new bank, the rest dropped (trivial, cued, duplicate,
unverifiable). For the nine unfinished categories the verdict is the same in principle, but no replacement
exists yet, so the old demo rows remain the only content there and must not be treated as launch material.

## Delivered: breaking-bad (65)

`seed/gusto/questions.C.tr.jsonl`, `externalId` `gusto-c-breaking-bad-001..065`, `AI_ASSISTED`.

- Difficulty: 3 easy, 36 medium, 26 hard. The easy share is below the 30 percent target on purpose: the easy
  items that could be written are exactly the childish ones the audit rejected, and nine of them were dropped
  as duplicates of the old demo bank.
- Correct-answer positions: 17 / 16 / 16 / 16.
- Sub-topics: production and creation, awards, episodes and finales, characters and cast, props and cars,
  story arcs (Gale and the book, Hank and Gus, the money burial), crew and music, tie-ins (El Camino,
  Better Call Saul), general.

## Dry run

```
pnpm --filter @quizparty/scripts run question import ../seed/gusto/questions.C.tr.jsonl --dry-run
[dry run] 65 rows: 65 CREATED
automatic review of the new questions: 65 -> 65 PASS / 0 REVIEW / 0 REJECT
```

(`pnpm db:migrate` had to be run first; migration 0011 was missing in the sandbox database.)
Fixes made during the audit: a profanity false positive on a poet's name, format and length clues
(correct answer longest or the only one with punctuation), overlapping numeric options, a stem parenthetical,
three exact duplicates of the old bank and one near-duplicate (dropped).

## What is still open

| Category | New questions | Reason |
|---|---|---|
| cinema-tv | 0 | search budget exhausted |
| gaming | 0 | search budget exhausted |
| business-economy | 0 | search budget exhausted |
| game-of-thrones | 0 | search budget exhausted |
| harry-potter | 0 | search budget exhausted |
| warhammer | 0 | search budget exhausted |
| breaking-bad | 65 | delivered |
| better-call-saul | 0 | search budget exhausted |
| the-office | 0 | search budget exhausted |
| how-i-met-your-mother | 0 | search budget exhausted |

Sub-topic plan for the remaining categories (to be verified, not yet written): cinema-tv (directors, awards,
festivals, film history, TV history, famous films, studios), gaming (consoles by era, franchises, studios,
indie, esports basics, Turkish scene), business-economy (companies and founders, brands, concepts, crises,
Turkish economy history in stable facts), fandoms (seasons, arcs, characters, cast, creators, production,
in-universe lore).
