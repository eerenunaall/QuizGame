# Slice A: Gusto question bank (general, geography, history, science, nature, math-logic, technology)

Output: `seed/gusto/questions.A.tr.jsonl` (`externalId` prefix `gusto-a-<category>-NNN`, `authorType: AI_ASSISTED`).
Owner target: 100 verified questions per category. Status at the end of this session:

| Category | Delivered (verified) | Target | Note |
|---|---|---|---|
| geography | 81 | 100 | complete as far as verified |
| general, history, science, nature, math-logic, technology | 0 | 100 each | **not started**: the shared web-search budget (200 calls per turn, shared by all agents) ran out while geography was being verified |

No unverified question was added to pad the count. The six empty categories need a follow-up run with a fresh
search budget (or a raised `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`).

## Verification method

- Evidence is WebSearch result text (standard mode; extended for the hardest item). WebFetch was not used, so the
  cited pages were not opened in full: the evidence is the search-result snippet from the cited domain.
- Every URL in `sources` was returned by a search for that fact (reputable domains: Britannica, UNESCO, Wikipedia,
  Guinness World Records, NASA, NOAA, USGS, ESA, National Geographic, KÜRE/TDV encyclopedias, ministry pages, WorldAtlas,
  Live Science, Smithsonian). `retrievedAt` and `lastVerifiedAt` are 2026-10-20.
- Two sources per fact, except where one encyclopedic source is a settled basic: Wellington (southernmost capital),
  Everest border, Dead Sea, Bering Strait, Greenland status use one or two weaker mirrors; reviewers may want a second look.
- Facts that sources disputed were dropped or reworded so only the undisputed core is asked (for example the
  Greenwich/GPS meridian offset, Vienna on the Danube, the Maldives' highest point, Dead Sea level in metres).

## Geography sub-topics (81 rows: 11 EASY, 49 MEDIUM, 21 HARD)

Türkiye doğası (6) · Türkiye mirası (8) · Başkentler (7) · Dağlar ve volkanlar (6) · Nehirler (5) · Göller (7) ·
Çöller (5) · Adalar (7) · Boğazlar ve kanallar (7) · Ülkeler ve sınırlar (6) · Okyanuslar ve koordinatlar (8) ·
Dünya mirası ve harikalar (9).

Correct-option index is balanced (21/20/20/20 over the four positions). Dry-run result:
`question import ../seed/gusto/questions.A.tr.jsonl --dry-run` → 81 CREATED, 81 PASS / 0 REVIEW / 0 REJECT
(no `--allow-dev-seed` needed).

Items deliberately left out because a fact could not be confirmed to the bar: Hürmüz Boğazı (sources were
time-sensitive news), Mississippi/Missouri length (content-farm sources only), Aconcagua and Vatikan area (only low-quality
sources came back), Ağrı Dağı height (no encyclopedic source returned), Macaristan landlocked, İstanbul on two
continents, Ural boundary, Cezayir as largest African country (search budget exhausted before these were checked).

## Audit of the existing bank (350 rows in these seven categories: 50 each, from `seed/questions.tr.jsonl`,
`seed/demo/questions.base1.tr.jsonl`, `seed/demo/questions.base2.tr.jsonl`)

Common problems: most EASY rows are childish ("Bir haftada kaç gün vardır?", "Bir üçgenin kaç kenarı vardır?"),
many MEDIUM rows are lookup trivia with weak distractors (numbers or same-category capitals), several rows are duplicates
across the three files (light speed, Euler's number, triangle angle sum, sunrise, Everest, Sahra, Süveyş), a few are
arguable or time-sensitive (Bern as "capital" has no formal status; Astana was renamed and renamed back; "most visited"
style claims), some leak the answer (Eyfel Kulesi/Paris style, "Nobel Barış Ödülü ... Oslo"), and some are
opinion-ish ("ormanların kralı").

Decisions:

- geography (50): 13 rewritten into the new set with better distractors, sources and explanation (Kızılırmak, Sinop,
  Canberra, Sahra, Süveyş/Panama, Baykal, Hazar, Pasifik, Kilimanjaro, Everest, Angel Şelalesi, Grönland, Mariana);
  37 dropped (childish capitals such as Roma/Berlin/Madrid/Tokyo, "Türkiye'nin başkenti", Bern, Astana, duplicates).
  None kept verbatim, because none was verified against sources.
- general, history, science, nature, math-logic, technology (300 rows): audited but not rewritten in this session.
  Verdict by tier: all EASY rows and every duplicate row are dropped (about 230 rows); the remaining 70 or so
  MEDIUM/HARD factual rows (for example WHO/IAEA/ICJ seats, Preveze, Malazgirt, Mondros, Kadeş, Cooper/Motorola,
  Turing/Enigma, ENIAC, Mendel, Fleming) are worth keeping **only after** source verification and distractor
  repair; they are not carried into this file.
