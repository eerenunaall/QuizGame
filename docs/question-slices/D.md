# Slice D: franchise and Turkish-culture categories (status: PARTIAL)

Categories of this slice: marvel, dc, hollywood, cult-films (existing) and the new turkiye-kulturu,
yesilcam-turk-dizileri, canakkale-ve-yoresi, masa-oyunlari, anime-cizgi-film, 90lar-nostalji,
futbol-turkiye. Target: 100 web-verified questions per category (`gusto-d-<category>-NNN`).

## Delivered

| Category | Verified questions | Target |
| --- | --- | --- |
| marvel | 39 | 100 |
| dc, hollywood, cult-films | 0 | 100 each |
| 7 new categories | 0 | 100 each |

`seed/gusto/questions.D.tr.jsonl` holds only the 39 marvel rows. Dry-run: 0 REJECT, a handful of
REVIEW (SIMILAR_QUESTION between the "director of film X" rows, which is by design).

## Why the rest is missing (honest status)

Verification needs WebSearch. The harness caps WebSearch at 200 calls per turn, shared by every agent
of the turn, and the cap was already reached after 11 calls of this slice (WebFetch is blocked: DNS
does not resolve). Rule: an unverified question is dropped, never kept. Nothing was written from memory.
To finish: raise `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` (or send follow-up turns) and re-run the
slice with the sub-topic plan below. Search snippets from reputable domains (Wikipedia, Britannica,
TheWrap, Marvel.com) are what the marvel sources are; fan wikis were used only as a second source for
release years and directors.

## Sub-topic plan (10 to 14 per category, 7 to 9 questions each)

- marvel: MCU release years and directors (done), MCU phases (done), Infinity Stones (done), Stan Lee
  (done), company history (done), Black Panther/Wakanda (done), X-Men (done), Wolverine (done); to do:
  Thor/Asgard lore, Guardians, Spider-Man, Thanos, Disney+ series, casting, villains, Avengers roster.
- dc: Superman, Batman, Wonder Woman, Flash/Green Lantern, Justice League, Gotham villains, creators,
  films and directors, Arkham, Krypton, Watchmen/Dark Knight Returns, first appearances.
- hollywood: Oscars records, studios and logos, Hollywood sign and Walk of Fame, golden age, directors,
  Disney/Pixar, franchises, silent to sound, women and firsts, composers.
- cult-films: Tarantino, Kubrick, Lynch, 80s cult, midnight movies, sci-fi cult, soundtracks, directors,
  cast trivia, production stories.
- turkiye-kulturu: bayramlar, el sanatlari (ebru, minyatur, ciniler), mutfak gelenekleri, ceyiz/dugun,
  UNESCO ogeleri, deyimler, geleneksel oyunlar, giyim, musiki, halk kulturu.
- yesilcam-turk-dizileri: Yesilcam yildizlari, yonetmenler, klasik filmler, kult diziler, replikler
  (fact only), muzikleri, odul ve festivaller.
- canakkale-ve-yoresi: Canakkale Savaslari (1915), Troya, Gelibolu Yarimadasi, Bozcaada, Gokceada,
  Boğaz, Ege kulturu, yoresel lezzetler, seramik, anitlar.
- masa-oyunlari: Catan, Monopoly, Risk, Ticket to Ride, Pandemic, Dixit, Mangala, satranc, tavla,
  oyun tasarimcilari, kural bilgisi, tarihce.
- anime-cizgi-film: Ghibli, Dragon Ball, One Piece, Naruto, Disney klasikleri, Tom ve Jerry,
  Looney Tunes, Simpsonlar, Turk cizgi filmleri, yapimcilar.
- 90lar-nostalji: oyuncaklar, TV programlari, muzik, teknoloji (Tamagotchi, Walkman, Nokia), dergiler,
  reklam, cizgi diziler.
- futbol-turkiye: kulupler, milli takim (Euro 2008, 2002 Dunya Kupasi), efsane oyuncular, teknik
  direktorler, statlar, kupalar. Only stable facts.

## Audit of the existing banks (200 rows: marvel, dc, hollywood, cult-films; demo-tr, demo-cult, demo-cult2)

Judged without web access to the sources, so none is carried over as verified. Result: all 200 stay
`DEV_SEED` and are retired by `question retire-dev --keep-prefix gusto-`.

- Drop (trivial or childish, about 70): "Iron Man'in gercek adi", "Hollywood hangi sehrin semti",
  "Batman'in yardimcisi", "Superman hangi gezegenden", character-name-from-hero lookups.
- Rewrite (ambiguous, weak distractors, or imprecise, about 25): "11 dalda Oscar kazanan filmlerden biri"
  (three films qualify), "Marvel'in 1939'daki ilk adi Timely Comics" (Timely Publications), "Aşağıdakilerden
  hangisi bir DC karakteridir" (distractors from another universe), "Hawkeye'in uzmanlik alani".
- Keep as source for re-verified rewrites (the rest): creators, first appearances, director and cast
  lookups. The verified marvel rows rewrite the good ones with sources.
- No row copied scripts or dialogue; franchise rows ask facts only.

## Tooling delivered by this slice

- `seed/gusto/categories.json`: 35 categories (17 launch + 11 demo + 7 new), each `id`, `tr`, `en`.
- Seven original badge icons (tea glass, television, anchor, die, smiling face, cassette, football),
  contrast >= 4.5:1, wired into `CATEGORY_ICONS`, the manifest test and `assets.test.ts`.
- `pnpm --filter @quizparty/scripts run question retire-dev --keep-prefix gusto- [--dry-run]`: ACTIVE ->
  RETIRED through the lifecycle (status log written), never deletes, works in every NODE_ENV, prints
  `retire-dev: N retired, M kept`. Tests in `tests/integration/question-cli.test.ts`.
