# Slice A: Gusto question bank (general, geography, history, science, nature, math-logic, technology)

Output: `seed/gusto/questions.A.tr.jsonl` (`externalId` prefix `gusto-a-<category>-NNN`, `authorType: AI_ASSISTED`).
Owner target: 100 verified questions per category. Status at the end of the second session (254 rows):

| Category | Delivered | Easy / Medium / Hard | Target | Note |
|---|---|---|---|---|
| geography | 81 | 11 / 49 / 21 | 100 | fixes from review round R1 applied |
| math-logic | 58 | 22 / 27 / 9 | 100 | verified by computation; the computation is in each explanation |
| history | 39 | 13 / 20 / 6 | 100 | |
| science | 33 | 10 / 20 / 3 | 100 | |
| general | 15 | 5 / 9 / 1 | 100 | |
| nature | 15 | 9 / 5 / 1 | 100 | |
| technology | 13 | 3 / 8 / 2 | 100 | |

Every category is short of 100. No unverified question was added to pad the count; the shortfall is caused by the
shared web-search budget (about 200 calls per turn for all agents) and by facts that sources did not confirm.

## Verification method

- Evidence is WebSearch result text (standard mode). WebFetch was not used, so the cited pages were not opened in
  full: the evidence is the search-result snippet from the cited domain. Searches were run by cluster (one overview
  page per 5-10 facts), with `allowed_domains` limited to Britannica, Wikipedia, NASA, NOAA, UNESCO, NIST, Nobel, IOC,
  History.com, KÜRE/TDV and similar.
- Every URL in `sources` was returned by a search for that fact. `retrievedAt` is the date of the search that returned
  it (2026-10-20 first session, 2026-10-25 second session).
- Two sources per fact; where only one encyclopedic source was available it is marked by a single `sources` entry
  (Wellington, Everest, Bering Strait, Dead Sea, Amazon museum pages, `amazon_hist`).
- Math-logic needs no source (category is not source-required). Each answer was checked by hand computation and the
  working is written in the explanation.
- Facts the sources disputed or did not cover were reworded to the undisputed core or dropped: Gutenberg's date,
  the Berlin Wall date, Mohaç/Preveze details, Karlofça, Turing test, Togg, Python/Java creators, Titanic/Chernobyl
  dates, Vienna on the Danube, the Maldives' highest point, the Dead Sea level in metres.

## Sub-topics (by category)

- geography: Türkiye doğası, Türkiye mirası, Başkentler, Dağlar ve volkanlar, Nehirler, Göller, Çöller, Adalar,
  Boğazlar ve kanallar, Ülkeler ve sınırlar, Okyanuslar ve koordinatlar, Dünya mirası ve harikalar.
- history: Cumhuriyet dönemi, Kurtuluş Savaşı, Cumhuriyet devrimleri, Çanakkale, Osmanlı tarihi, Selçuklular, Eski Mısır,
  Antik Çağ, Dünya Savaşları, Uzay yarışı, Roma, Antik Yunan, Ortaçağ, Anadolu uygarlıkları, Olimpiyatlar, Felaketler.
- science: Fizik, Kimya, Astronomi, Nobel ve bilim insanları, Bilim tarihi, Biyoloji, İnsan vücudu.
- nature: Hayvan rekorları, Göç ve davranış, Hayvan anatomisi, Memeliler, Türkiye doğası, Ekosistemler.
- technology: İnternet tarihi, Teknoloji şirketleri, Kablosuz teknolojiler, Programlama, Türk teknolojisi.
- general: Takvim ve zaman, İcatlar, Uluslararası kuruluşlar, Olimpiyatlar, Diller.
- math-logic: Aritmetik, Yüzde ve oran, Geometri, Diziler, Kombinatorik, Mantık, Sayılar, Birimler, Cebir, Problemler,
  Olasılık, Kesirler, Sayı sistemleri, İstatistik.

## Difficulty mix

The first session ran too hard; this session's target was 40% easy / 40% medium / 20% hard. Achieved overall: 63 easy,
138 medium, 53 hard (geography, written first, is the hardest slice and is left as it was apart from the R1 fixes).

## Dry-run audit

`question import ../seed/gusto/questions.A.tr.jsonl --dry-run` (no `--allow-dev-seed` needed): 254 rows, 254 CREATED,
**223 PASS / 31 REVIEW / 0 REJECT**. The 31 REVIEW rows are all soft findings that are not factual errors:
SIMILAR_QUESTION (20; the row resembles a row of the older dev seed or another sequence/arithmetic row of this file),
OPTIONS_NEARLY_IDENTICAL / OVERLAPPING_OPTIONS (numeric answer sets such as dates, unit conversions or percentages,
unavoidable for the question type), ABSOLUTE_CLAIM (the "kesinlikle doğru" logic row) and ANSWER_STEM_IN_QUESTION
(the "Pamuk is an animal" syllogism repeats the name by necessity).

## Round R1 fixes applied (geography)

041 (Sahra: stem no longer says "iki kutup çölü"; the question is now asked by area), 047 (Grönland: "krallık" cue
removed, plain "ülke"), 008 (typo "Ermenistan"), 063 (Fransa explanation simplified).

## Audit of the existing bank (350 rows in these seven categories: 50 each, from `seed/questions.tr.jsonl`,
`seed/demo/questions.base1.tr.jsonl`, `seed/demo/questions.base2.tr.jsonl`)

Common problems: most EASY rows are childish ("Bir haftada kaç gün vardır?", "Bir üçgenin kaç kenarı vardır?"),
many MEDIUM rows are lookup trivia with weak distractors, several rows are duplicates across the three files (light
speed, Euler's number, triangle angle sum, sunrise, Everest, Sahra, Süveyş), a few are arguable or time-sensitive (Bern
as "capital" has no formal status; Astana was renamed and renamed back), some leak the answer, and some are
opinion-ish ("ormanların kralı").

Decisions: geography 13 rewritten into the new set, 37 dropped. For the other six categories (300 rows) all EASY rows
and every duplicate row are dropped (about 230); the remaining 70 or so MEDIUM/HARD factual rows are worth keeping only
after source verification and distractor repair. Where this session's rows reuse a topic of the old bank (for example
WHO/UNESCO seats, Gregoryen takvim, Rosetta, Fleming-era discoveries) they are rewrites of the old row, not copies.
