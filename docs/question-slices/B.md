# Question slice B (Gusto bank): art-culture, literature, language-words, mythology-folklore, music, sports, food-drink

Target: 100 web-verified Turkish questions per category (`seed/gusto/questions.B.tr.jsonl`,
ids `gusto-b-<category>-NNN`, `authorType: AI_ASSISTED`). Rule: an unverified question is dropped, never padded.

## Status (end of second turn)

| Category | Delivered (verified) | Note |
|---|---|---|
| art-culture | 88 | 12 short of 100 |
| literature | 18 | 82 short |
| language-words | 14 | 86 short |
| mythology-folklore | 31 | 69 short |
| music | 14 | 86 short |
| sports | 21 | 79 short |
| food-drink | 18 | 82 short |
| Total | 204 | see below |

Difficulty of the 204 rows is skewed toward HARD/MEDIUM (36 easy, 78 medium, 90 hard) because the
verified clusters yielded mostly specific facts. More easy, well-sourced items are needed in the next turn.

The shared WebSearch budget limited each turn (about 60 searches in turn 1, 35 in turn 2). Verification was
done by cluster (one overview query per 5-10 facts). Facts a cluster did not confirm were dropped: Pamuk's Nobel
year, Dylan 2016, Huzur and Saatleri Ayarlama Enstitusu dates, Cıralikusu and Ask-i Memnu book dates (serial vs book
ambiguity), Nazim Hikmet, Yunus Emre, Fuzuli, Esperanto, Braille, Cyrillic attribution, Sefiller-type unchecked
items, Moby-Dick and 1984 years, Zeybek/UNESCO, FIFA Klose and Maradona items, Hidayet Turkoglu 2008, FIBA and NBA
founding years, Gastronomic Meal of the French, Kimjang, "Gelibolu sardalyasi" GI, Kaldi details beyond the
legend, plus any Kirkpinar founding year (1360/1361/1362 disputed).

## Evidence note

WebFetch is blocked in this sandbox (DNS failure), so evidence is WebSearch result summaries from reputable
domains (Wikipedia, Britannica, UNESCO, Tate, MoMA, national museums, TDV Islam Ansiklopedisi, Kultur Portali,
ministry and university pages). Most questions cite two sources. A few settled single-fact items cite one. Some
Turkish news pages (TRT Haber, Milliyet, CNN Turk, Timeturk) back secondary claims only. Every `sources` entry has
`retrievedAt` 2026-10-20. Ambiguities found during search were reworded or dropped (for example an unconfirmed
"less is more" attribution, the Pergamon Altar location source, Kusama, Banksy, the Nutcracker Christmas Eve
detail, and Sultanahmet "Mavi Cami" and sikke claims that could not be searched).

## Sub-topics, art-culture (10)

World painting; sculpture; world architecture; stage arts and museums; photography and modern art;
architecture in Turkiye; Anatolian antiquity and UNESCO; traditional Turkish arts (ebru, hat, cini, halı, minyatür,
gölge oyunu, ortaoyunu, Canakkale seramigi); folk culture and celebrations (Hıdırellez, Sema, Nasreddin Hoca);
Turkish art institutions and artists.

Planned for the rest (not delivered): literature (Turk roman/siir/halk edebiyati, dunya klasikleri, Nobel,
masal ve fıkra, tiyatro), language-words (dil devrimi, atasozu ve deyim, etimoloji, alfabeler, dil aileleri),
mythology-folklore (Yunan, Roma, Iskandinav, Misir, Turk ve Anadolu efsaneleri, Truva), music (halk, sanat, pop,
rock, arabesk, klasik, caz, ceyrek), sports (futbol, basketbol, voleybol, Olimpiyat, guresler, geleneksel sporlar),
food-drink (bolge mutfaklari, dunya mutfagi, icecekler, malzemeler).

## Audit of the existing banks (350 questions in these 7 categories, 50 per category, all three files)

Read in full. Judgement, not machine scoring:

- Drop about 270. Childish or trivial ("bir haftada kac gun", "elma kac hecelidir", "kitabin cogulu"), answer
  leaks, near-duplicates across the files (Mozart's birthplace, Orhan Pamuk's Nobel year, Nasreddin Hoca's
  "maya" joke, Shakespeare's Romeo, Dante's Inferno asked three ways), and arguable or outdated items
  ("en cok ulkede resmi dil", record holders such as Bolt's world record, "Pele kac kez kazandi").
- Rewrite about 30 into the new set where the topic is good but the stem was weak (Guernica, Anıtkabir,
  Osman Hamdi Bey, Sinan's three works, Hereke, Cubism, Liberty statue, Godot, Last Supper, Nasreddin Hoca, Göbekli Tepe).
- Keep about 50 as acceptable but not yet re-verified (stay `DEV_SEED`; not migrated): for example Tutunamayanlar,
  Kuyucaklı Yusuf, Ince Memed's setting, Hakan Sukur's 2002 goal, Robert Capa-type basics. They should move
  only after verification.
- Specific defects spotted: wrong Turkish typography in options ("Nasreddin Hoca ... maya" duplicates), mismatched
  distractor types (a year among cities), lone-correct longest options, "Sanat Gunesi"-style opinion/lakap items
  with disputed attributions.

## Dry-run audit

`pnpm --filter @quizparty/scripts run question import ../seed/gusto/questions.B.tr.jsonl --dry-run`:
204 rows, 204 CREATED, 0 DUPLICATE, 0 REJECT, 200 PASS, 4 REVIEW (all `CATEGORY_MISMATCH_SUSPECT`:
Globe/Wanamaker, Mevlevi ayin, Ankara State Conservatory/Hindemith inside art-culture, and the Ode to Joy poet
question in music; they cross-cut art-culture and music).

Correct index is rotated by position (`(n-1) mod 4`) so it is evenly distributed.
