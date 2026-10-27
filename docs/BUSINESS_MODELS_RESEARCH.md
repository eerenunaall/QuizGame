# Business models research: how browser party and trivia games make money, and a plan for QuizNight

Status: Research / proposal (not an ADR) · Date: 2026-10-19 · Companion to `docs/MONETIZATION_RESEARCH.md`
(payment provider and price points) and ADR-0024 (venue mode).

**Not legal or tax advice.** Evidence markers, as in the monetization research:

- **[V]**: verified on the company's or platform's own page or filing (seen through search results on that official
  domain; direct page fetches of `docs.crazygames.com` and `sdk.poki.com` failed DNS in the sandbox).
- **[S]**: secondary source (press, aggregator, blog, forum). Probably right, but check before relying on it.
- **[I]**: our inference. Treat it as a hypothesis.

"Unknown" means we searched and found no public number. We do not invent revenue figures.

---

## 0. Sahibi için özet (Türkçe)

**Kısaca:** Basit tarayıcı oyunları dört yoldan para kazanıyor. (1) Reklam: skribbl, Gartic, .io oyunları, Sporcle
ve portallar (CrazyGames, Poki). Bunun için çok büyük trafik gerekir ve oyuncu başına gelir çok düşüktür. (2) Abonelik:
GeoGuessr, NYT Games, Board Game Arena, Sporcle Orange, Kahoot. (3) Tek seferlik satın alma: Jackbox. (4) B2B, yani
okul, şirket ve etkinlik lisansları: Kahoot gelirinin büyük kısmı buradan gelir. Bizim modelimize en yakın örnekler
Jackbox ("ev sahibi bir kez öder, telefondaki oyuncular bedava") ve Board Game Arena'dır (BGA'da masayı açan tek kişinin
Premium olması yeter).

**Önerim (gelir/emek sırasıyla):**
1. **Kafe/bar lisansı (venue mode):** zaten yapıyoruz ve ilk müşteri Gusto hazır. Aylık sabit ücret, örneğin
   ₺1.500–2.500/ay/mekân [I]. Türkiye'de en hızlı gerçek para buradan gelir.
2. **Ev sahibi web satışı (Paddle):** Parti Gecesi ₺129 ve Ömür Boyu ₺349; tasarımı `MONETIZATION_RESEARCH.md`'de var.
   Reklam yok, abonelik yok.
3. **Şirket etkinliği / takım oyunu paketi:** etkinlik başına ücret, şirket logosu ve özel soru seti. Kahoot'un
   "event pass"i ~$250'dır [S]; Türkiye için ₺5.000–15.000/etkinlik makul görünüyor [I].
4. **Yayıncı modu + markalı oda:** doğrudan gelirden çok büyüme için; Gartic ve Jackbox yayıncılarla büyüdü.
5. Sonra: ücretli kategori paketleri, host'a özel temalar (kozmetik, oyuncuya avantaj sağlamaz).
6. **Önermiyorum (şimdilik):** telefonda reklam (az para, KVKK açık rıza yükü, ürün kuralına ters), Poki (5–7 yıl
   web münhasırlığı ister, kendi alan adımızla çelişir), Discord Activity (**Discord Türkiye'de Ekim 2024'ten beri
   erişime kapalı**), okul lisansı (çocuk verisi, uzun satış süreci).

**İlk 3 adım:** (a) Gusto ile 1 aylık ücretli pilot yap, fiyatı ve bir sözleşme şablonunu netleştir, 3–5 kafeye daha
gönder. (b) Paddle başvurusunu yap ve 10 doların altındaki ürünler için özel fiyat iste. (c) Yayıncı modunu (oda
kodunu gizleme, uzun süreler, aile filtresi) ve sonuç ekranında "paylaş" kartını ekle; 3 Türk yayıncıya ücretsiz
Ömür Boyu kodu ver.

---

## 1. What QuizNight is, and the rules any money plan must respect

QuizNight: browser only, the TV or laptop is the stage, phones are controllers (QR join, no install, no store).
Product rules taken from the GDD §6 and ADR-0012/0013/0018/0024:

1. **Players never pay, never pay to win.** Nothing bought changes scoring, powers or odds.
2. **Only the host pays** (account entitlements `FREE`/`FULL`, ADR-0013).
3. **No ads during active play or between questions, no ad interrupting the TV presentation** (GDD §6.2).
4. **Privacy/KVKK** (ADR-0018): data minimisation, no tracking that needs consent we do not want to collect.
5. **Browser only**, no Apple/Google store purchases (avoids their IAP rules, see GDD §6).
6. **Venue mode never moves money** (ADR-0024 §Context): staff collect money, the app meters time.

---

## 2. Case studies

Each entry: model · what is charged and at what price · what players tolerate · revenue scale · why it grew.

### 2.1 Gartic Phone / Gartic.io (Onrizon, Brazil)
- **Model:** free web game, ad-supported [S]. A review lists it as "free, with ads" on iOS, Android and desktop [S].
  The ad network and any premium tier: unknown (not found).
- **Players tolerate:** ads around (not inside) rounds [I]; private rooms and no account keep friction near zero.
- **Revenue:** unknown.
- **Growth:** released 7 Oct 2020 in lockdown; spread on Twitch and YouTube where streamers ran private rooms with
  viewers; TikTok clips with 3.2M and 10.2M plays; Twitch "Gartic" category peak 50.6K viewers (Oct 2021) [S].
  The game is a content machine: every round produces a funny, shareable artefact [I].
- Sources: [KnowYourMeme guide](https://knowyourmeme.com/editorials/guides/what-is-gartic-phone-and-why-do-streamers-love-it-the-multiplayer-drawing-game-explained) ·
  [WhistleOut review](https://www.whistleout.com/CellPhones/Apps/gartic-phone-app-review) ·
  [StreamsCharts Gartic](https://streamscharts.com/games/gartic).
  A Fanta/Twitch branded activation was mentioned in one LinkedIn snippet but **could not be confirmed**; we do not
  rely on it.

### 2.2 skribbl.io
- **Model:** free, ad-supported [S]. Also distributed on CrazyGames (listing exists [V]), which shares ad revenue with
  developers. Claims of a premium tier come from an aggregator and contradict other sources: unverified.
- **Revenue:** unknown.
- **Growth:** zero-install private rooms with a link, custom word lists, streamers [I].
- Sources: [CrazyGames listing](https://www.crazygames.com/pl/game/skribblio) ·
  [Zoftwarehub (aggregator)](https://zoftwarehub.com/products/skribble/pricing).

### 2.3 Jackbox Games (Party Packs + free jackbox.tv controller)
- **Model:** one-time purchase of a pack by the host on Steam/consoles/etc.; **players join free in a browser at
  jackbox.tv** (no install). Pack 11: $29.99 [V, see MONETIZATION_RESEARCH §3.1]. Free "Megapicker" launcher funnels to
  packs [V]. No ads in the controller [I, none observed or reported].
- **Revenue:** private company, no official figures. Third-party Steam estimates: Party Pack 3 ≈ $1.9M, Pack 5 ≈
  $1.1M gross on Steam alone (modelled) [S]. Post-lockdown sales slump reported; 2026 strategy adds third-party
  publishing, standalone titles and **Netflix CTV distribution** of three titles; on 12 platforms [S].
- **B2B/events:** dedicated "Jackbox for Events/Students" pages and a guide for hosting in public settings; business
  enquiries by email; no public venue price [V].
- **Growth:** built for streamers: Streamer Mode where the audience votes as a group, room-code hiding, "Require
  Twitch" login, extended timers for stream delay, family-friendly filter, a moderator controller [V].
- **Lesson for us:** the exact model we have (host pays once, phones free in the browser), plus the streamer
  feature set is a growth engine, not a revenue line.
- Sources: [GamesBeat 2026 strategy](https://gamesbeat.com/publishing-streaming-and-standalone-games-inside-jackbox-games-strategic-shift-in-2026/) ·
  [GameDev.net market trends](https://gamedev.net/news/topic/market-trends/) ·
  [Raijin Pack 3 estimate](https://raijin.gg/app/434170/The_Jackbox_Party_Pack_3) ·
  [SteamPulse Pack 5](https://www.steampulse.org/game/774461) ·
  [Jackbox for events](https://www.jackboxgames.com/jackbox-for-events/) ·
  [Streaming/moderation features PP8](https://www.jackboxgames.com/streaming-moderation-accessibility-features-jackbox-party-pack-eight/) ·
  [So You Want To Stream Jackbox](https://www.jackboxgames.com/blog/so-you-want-to-stream-jackbox).

### 2.4 Kahoot!
- **Model:** freemium SaaS. Free plan capped (Kahoot! Go: 10 players, non-commercial only) [S]. Personal Kahoot!+
  tiers by player cap: Bronze $3/mo yearly (50 players), Silver $7/mo, Gold $12/mo (200), One ~$19/mo [V/S mixed].
  Business "360" plans from ~$29–54/host/month up to $6,000–7,500+/year; **event passes** (e.g. "Event Bronze" $250
  for a one-time event up to 100 attendees) [S]. Branded quizzes for companies via verified profiles on Discover
  ("brand engagement") with no public rate card [V].
- **Revenue scale (the only verified one in this set):** 2022 invoiced revenue **$169.0M** (core platform >$75M, >700K
  paid subscriptions) [V]. Q2 2023: 1.37M paid subscriptions, of which Work 604K and Education 458K [V]. Taken private
  by a Goldman Sachs-led consortium for ~$1.7B (2023), delisted Jan 2024 [S].
- **Lesson:** the money is in **B2B (work + schools)**, priced by player cap and per event, not in consumers.
- Sources: [4Q22 report](https://kahoot.com/files/2023/02/4Q22_Kahoot_quarterly_report.pdf) ·
  [2Q23 presentation](https://kahoot.com/files/2023/08/2Q23_Kahoot_quarterly_presentaton.pdf) ·
  [Personal pricing](https://kahoot.com/pricing-personal/) · [Kahoot 360 brand engagement](https://kahoot360.com/es/brand-engagement/) ·
  [Kahoot 360 pricing](https://kahoot360.com/de/pricing-slider-2/) · [Nibble pricing guide](https://nibble-app.com/blog/kahoot-cost) ·
  [Go-private deal](https://www.hcmtechnologyreport.com/learning-platform-kahoot-to-go-private-in-1-7-billion-deal/).

### 2.5 GeoGuessr
- **Model:** subscription (Pro). Was freemium; moved to a **fully paid subscription in early 2024** to cover Google
  Maps/Street View API costs [S]. Prices vary by region and source: ~$2.99/mo billed yearly, ~$5.99 monthly; Poland
  19.99 zł/mo [S].
- **Revenue:** Dealroom range $10–50M/year [S]; exact unknown.
- **Players tolerate:** grumbling and free clones appeared when the free tier ended [S]. The paywall was driven by a
  per-play variable cost we do not have (our marginal cost per game is tiny [I]).
- **Growth:** creators (Rainbolt's TikTok clips, Sidemen on YouTube) in the pandemic; users from ~10M (2019) to 80M+
  (2024) [S]; a World Cup/ranked scene [S].
- Sources: [Dealroom](https://dealroom.co/companies/geoguessr/) · [OMR on the World Cup](https://omr.com/de/daily/geoguessr-world-cup-wachstum) ·
  [Antyweb prices](https://antyweb.pl/ile-kosztuje-geoguessr-i-dlaczego-jest-platny) ·
  [Sportskeeda paywall reaction](https://www.sportskeeda.com/esports/news-corpo-gonna-corpo-geoguessr-going-paid-ending-free-subscription-fans-disappointed).

### 2.6 Wordle / NYT Games
- **Model:** Wordle stays free with ads for non-subscribers and a registration wall for streaks; the NYT sells a Games
  subscription (~$1.50/week US list) and bundles it into All Access [S]. Bought in early 2022 for "low seven figures" [S].
- **Revenue:** Games passed 1M subscriptions around end-2021; the NYT has not broken it out since [S].
- **Growth:** the **emoji result grid** that shares without spoilers took it from ~90 players (Nov 2021) to ~300K
  (early Jan 2022) and ~2M (late Jan) [S]. Once a day, the same puzzle for everyone, a conversation starter.
- **Lesson:** a spoiler-free, one-tap share card at results is the cheapest growth feature that exists.
- Sources: [A Media Operator on NYT Games](https://www.amediaoperator.com/analysis/wordle-tv-show-new-york-times-games-jonathan-knight/) ·
  [iMore on the purchase](https://imore.com/wordle-bought-new-york-times-will-remain-free-initially) ·
  [KnowYourMeme Wordle](https://knowyourmeme.com/memes/subcultures/wordle).

### 2.7 Codenames Online (Czech Games Edition)
- **Model:** the web version at codenames.game is free without registration [S]; how it is funded (ads, donations)
  is unknown. The separate Codenames app is a **one-time $4.99**, chosen by CGE explicitly to avoid ads and
  subscriptions [V]. The web game is plausibly marketing for the physical game (inferred: brand halo) [I].
- Sources: [Codenames app FAQ](https://www.codenamesgame.com/news/the-codenames-app-what-you-wanted-to-know-but-were-afraid-to-ask) ·
  [Galaxus](https://galaxus.at/en/page/codenames-brettspiel-boomt-als-online-game-28583).

### 2.8 Board Game Arena (Asmodee)
- **Model:** free tier + Premium subscription: **$5/month, annual raised from $36 to $42 (1 July 2025)** [V, BGA forum
  announcement]. **For Premium games only the player who creates the table needs Premium**; free players join [S,
  quoting BGA FAQ]. Revenues are shared with publishers as royalties [S].
- **Revenue:** unknown. 10M+ registered accounts (Asmodee) [V]; 69M hours played in 2025 [S].
- **Lesson:** "one paying host unlocks the table for everyone" is proven at scale in browser games. This is our model.
- Sources: [BGA price update](https://forum.boardgamearena.com/viewtopic.php?p=215420) ·
  [Asmodee 10M users](https://corporate.asmodee.com/news/asmodee-and-board-game-arena-celebrate-10-million-users-milestone-cementing-the-online-board-gaming-platform-as-the-industrys-1) ·
  [BGA guide (Derby Union)](https://derbyunion.co.uk/pageassets/societies/gaming/events/Online-Events-Board-Game-Arena-Guide(1).docx) ·
  [Meeple Mountain](https://www.meeplemountain.com/articles/board-game-arena-is-my-2025-game-of-the-year/).

### 2.9 Among Us and its web clones
- **Model:** Innersloth: paid on PC (~$4.99), free with ads + cosmetics on mobile; ~$39M player spending on mobile by
  2020 per Sensor Tower [S]; Superdata noted it struggled to monetise its audience [S]. Web clones: no reliable data
  found. Clones on portals live on ad revenue share [I].
- **Growth:** streamers in 2020; social deduction is natural stream content [S/I].
- Sources: [PocketGamer.biz](https://www.pocketgamer.biz/news/75000/mobile-game-monetization-strategies/) ·
  [Vidaextra/Superdata](https://www.vidaextra.com/pc/among-us-juego-jugadores-mensuales-ha-teniendo-problemas-para-monetizar-su-exito-superdata).

### 2.10 Quizizz (now Wayground)
- **Model:** freemium for teachers + **school/district plans paid by purchase order**, with LMS integrations,
  reporting, success managers; markets eligibility for US federal funding (ESSER, Title I) [V]. Prices not public;
  aggregators list $59–99/user/month (likely wrong or old) [S].
- **Lesson:** education money is district procurement, slow and paperwork-heavy. Not a solo-dev first move.
- Sources: [Wayground plans](https://wayground.com/home/en/plans) · [Software Advice](https://www.softwareadvice.com/hr/quizizz-profile).

### 2.11 Sporcle
- **Model:** free with display ads; **Sporcle Orange** removes ads and adds extras: **$3.99/month or $43.99/year**,
  family $6.99/$74.99 [V]. Also runs live pub-trivia events in the US [I, widely known, not re-verified here].
- **Revenue:** unknown.
- Sources: [Sporcle memberships](https://www.sporcle.com/memberships/) · [Wikipedia](https://en.wikipedia.org/wiki/Sporcle).

### 2.12 JetPunk
- **Model:** ads + Premium (~$2/month, ad-free and extra stats) [S]. The site's owner reportedly said Premium "barely
  brings in any revenue" [S]: ad removal alone is a weak product.
- Sources: [JetPunk user blog](https://www.jetpunk.com/users/akjlddkjslfsd/blog/five-years-of-jetpunking) · [Wikipedia](https://en.wikipedia.org/wiki/JetPunk).

### 2.13 Krunker.io
- **Model:** free browser shooter; ads + **cosmetics** (skins, masks, taunts via drops or microtransactions, with
  player trading) [S]. Acquired by FRVR in May 2022 (price undisclosed) with "200M+ unique players" claimed [V, FRVR
  press release via GameDeveloper].
- **Revenue:** unknown. **Growth:** YouTubers, modding, 50K user maps [S].
- Sources: [GameDeveloper press release](https://www.gamedeveloper.com/press-release/frvr-acquires-popular-free-to-play-shooter-krunkerio) ·
  [GamesBeat](https://gamesbeat.com/frvr-acquires-free-to-play-shooter-krunker-io/).

### 2.14 agar.io and the .io genre
- **Model:** web: ads; mobile (Miniclip as publisher): ads + skins + coins + a **$7.99/week VIP** subscription [S].
  In 2016, 41 % of Miniclip's ad revenue came from playable ads [S]. Reviewers complain about ad load [S].
- **Ad networks for .io web games:** AdinPlay (owned by Venatus since 2023) serves casual/social game sites with
  video, reward video and takeovers; no public revenue share; geared to established portals [S]. One .io developer
  reported ~€1.2 CPM video and €0.25 banner (2020 anecdote) [S]. **Google H5 Games Ads** (interstitial/rewarded on
  AdSense) is a **closed beta, approval not guaranteed** [V].
- **Arithmetic [I]:** at ~€1 per 1,000 video views, 10,000 phone-lobby impressions/day ≈ €10/day ≈ €300/month, before
  consent losses. That is roughly 60 Lifetime sales.
- Sources: [PocketGamer Miniclip/MoPub](https://www.pocketgamer.biz/miniclip-mopub-case-study/) ·
  [agar.io App Store](https://apps.apple.com/app/id995999703) · [AdinPlay](https://adinplay.com) ·
  [IndieHackers io CPMs](https://www.indiehackers.com/product/golf-royale/making-money-from-my-io-game-taking-off--M8NPv4qvdUnfedYGWXv) ·
  [AdSense H5 Games Ads](https://adsense.google.com/start/h5-games-ads/) · [Ad Placement API beta](https://developers.google.com/ad-placement/docs/beta?hl=hi).

### 2.15 Game portals: CrazyGames and Poki
- **CrazyGames:** monetisation is **ad revenue share through their SDK only** ("only ads served through our SDK are
  allowed") [V]; exact split not public (third parties: 50–70 % of ad revenue; jam terms 60 % ads / 70 % IAP) [S].
  In-game purchases only for selected games [V]. Basic Launch without SDK (limited traffic test), Full Launch requires
  the SDK [V/S]. Limits: initial download ≤ 50MB (≤ 20MB for the mobile homepage), 250MB total, 1,500 files; must
  work on Chrome/Edge [V]. Multiplayer: report rooms through the SDK so CrazyGames' own Join/Invite works; guests must
  be able to play; external logins disabled at basic tier [V]. No exclusivity requirement found [S/I].
- **Poki:** developer gets **100 % of revenue on traffic they bring, 50 % on traffic Poki brings** [V], but prefers
  **web exclusivity for 5 or 7 years** (pages disagree), which treats Discord and YouTube Playables as "web" [V].
  Non-exclusive deals are a one-time licence fee [V]. Initial download target < 8MB; `commercialBreak()`/
  `rewardedBreak()` with Poki controlling frequency [V].
- **Can a TV + phone game fit? [I]** Poorly. Portals monetise **the screen that loads their page**. For us that is
  the TV, exactly where the GDD forbids ads between questions. The phones would join via QR on our own domain, so they
  are outside the portal's SDK, ads and accounts. The "Join/Invite" model assumes every player opens the portal page.
  Poki's exclusivity would block our own domain, venue mode and any future Discord build. A portal build would have to
  be a **different product**: single-screen "pass-and-play" or "everyone on their own device" mode, with ads only at
  natural breaks (after a full game), which is a lot of work for low CPMs.
- Sources: [CrazyGames requirements](https://docs.crazygames.com/requirements/intro/) ·
  [Technical](https://docs.crazygames.com/requirements/technical) · [Multiplayer](https://docs.crazygames.com/requirements/multiplayer/) ·
  [Account integration](https://docs.crazygames.com/requirements/account-integration/) ·
  [Cinevva guide](https://app.cinevva.com/guides/publish-game-crazygames) · [Poki deals](https://sdk.poki.com/deals) ·
  [Poki bonus](https://sdk.poki.com/bonus) · [Poki new requirements](https://sdk.poki.com/new-requirements) ·
  [Playgama on exclusivity](https://playgama.com/blog/business-faqs/should-i-go-exclusive-with-one-web/).

### 2.16 Discord Activities
- **Model:** web app in an iframe inside Discord (desktop, mobile, web) via the Embedded App SDK [V]. Premium Apps:
  subscriptions (user or server) and one-time/consumable SKUs with Discord checkout; Activities must render their own
  storefront [V]. **Developer keeps 85 % on the first $1M cumulative gross, then 70 %** (less processing fees) [V].
  Price parity: not cheaper elsewhere than in Discord (from 7 Oct 2024) [V]. Monetisation opened first for US/UK/EU,
  desktop [S]. Apps used by 25 %+ of Discord MAU, per Discord [V].
- **Fit [I]:** everyone sits in a voice channel on their own device, which is not our TV + phones setup (it would
  need an "everyone on own screen" mode). **Discord has been blocked in Turkey since 9 Oct 2024** by court order; a
  minister said in June 2026 it would "probably" reopen; no lifting decision found by end of Aug 2026 [S]. Our
  first market cannot reach it; payouts to a Turkish individual are unconfirmed.
- Sources: [Discord Activities overview](https://docs.discord.com/developers/activities/overview.md) ·
  [Monetization overview](https://docs.discord.com/developers/monetization/overview.md) ·
  [IAP for Activities](https://docs.discord.com/developers/monetization/implementing-iap-for-activities.md) ·
  [Premium Apps payout](https://support-dev.discord.com/hc/en-us/articles/17299902720919-Premium-Apps-Payout) ·
  [Discord blog](https://discord.com/blog/build-where-the-world-plays) ·
  [PocketGamer.biz](https://www.pocketgamer.biz/discord-activities-opens-up-to-all-developers-to-make-games-on-the-platform) ·
  [NTV: block](https://www.ntv.com.tr/turkiye/discorda-erisim-engeli,nnlgpHdb40Kh1XAiLzrJVQ) ·
  [Turkgun: minister June 2026](https://www.turkgun.com/bilim-teknoloji/discord-acilacak-mi-ne-zaman-bakan-uraloglu-aciklamasi-2026/378501).

### 2.17 Twitch Extensions
- **Model:** Bits in Extensions: **80 % to the streamer, 20 % to the extension developer** (2018 launch terms;
  "may be adjusted or deprecated") [V for 2018, current status not confirmed].
- **Fit [I]:** tiny money for a developer. Value is promotional (an overlay showing the live leaderboard) not revenue.
- Sources: [Twitch blog 2018](https://blog.twitch.tv/en/2018/04/23/the-next-big-update-for-extensions-is-here-a036151cc309) ·
  [TechCrunch](https://techcrunch.com/2018/04/23/twitchs-creators-and-developers-gain-a-new-revenue-stream-with-launch-of-bits-in-extensions).

### 2.18 Also relevant: AirConsole (TV + phone controllers, closest technical peer)
- Free tier + **Hero** ($7.99/month, cheaper yearly, lifetime option [S]). The bigger business turned out to be
  **B2B licensing to car makers** (BMW Curved Display from 2023; VW sells it inside a $149/year in-vehicle plan) [S].
  KPIT bought 13 % of N-Dream for €3M [S]. Lesson: the TV+phone platform found its money in licensing the screen, not
  in consumers.
- Sources: [paultan.org BMW](https://paultan.org/2022/10/12/bmw-airconsole-casual-gaming-partnership) ·
  [StartupHub VW](https://www.startuphub.ai/news/volkswagen-bets-parked-play-will-sell-subscriptions) ·
  [Preqin N-Dream](https://www.preqin.com/data/profile/asset/n-dream-ag/354716).

### 2.19 Venue / bar trivia software (our ADR-0024 market)
- AMI Trivia (US bars): **$149–199/month + setup** [S, vendor page]. Trivnow: $25–100/month [S]. Quizado: €49/month
  single venue, €89 with own question sets [S, vendor]. Hosted trivia services: $399–725 per event [S].
- Istanbul: Yabangee runs weekly bilingual pub quizzes; tickets **₺250** per person (2026) [S]. Proof that Turkish
  venues already sell quiz nights as a ticketed event.
- Turkish B2B quiz platforms exist (QuizModeOn: brands and in-company engagement, prices not public) [S].
- Sources: [AMI Entertainment](https://amientertainment.com/?p=6236) · [Trivnow on G2](https://www.g2.com/sellers/trivnow) ·
  [Quizado comparison](https://quizado.com/compare/bar-trivia-company-vs-software) ·
  [Meetup/Yabangee](https://www.meetup.com/Istanbul-Community-for-Foreigners-English-Speakers/) ·
  [Nomad.watch event](https://nomad.watch/events/pub-quiz-on-cats-questions-in-english-turkish-20260805) ·
  [Webrazzi QuizModeOn](https://webrazzi.com/2020/07/21/markalarin-canli-yarismalar-duzenlemesine-yardimci-olan-quiz-platformu-quizmodeon/).

---

## 3. Comparison table

| Product | Main money | Second money | Who pays | Typical price | Public revenue | Growth driver |
|---|---|---|---|---|---|---|
| Gartic Phone | Ads [S] | Unknown | Nobody (advertisers) | $0 | Unknown | Streamers, TikTok clips |
| skribbl.io | Ads [S] | Portal rev-share [I] | Advertisers | $0 | Unknown | Link rooms, streamers |
| Jackbox | One-time pack [V] | Netflix/platform deals [S] | Host only | $20–30 | Est. $1–2M/pack on Steam [S] | Streamer mode, audience |
| Kahoot | B2B SaaS [V] | Consumer subs, events, brands | Teacher/company host | $3–19/mo; $250 event; $6k+/yr | $169M (2022) [V] | Schools, word of mouth |
| GeoGuessr | Subscription [S] | Esports/events | Each player | ~$3–6/mo | $10–50M range [S] | Creators |
| Wordle / NYT | Bundle subscription [S] | Ads | Reader | ~$1.50/wk | >1M Games subs (2021) [S] | Emoji share grid |
| Codenames Online | Free (unknown) | Paid app $4.99 [V] | App buyer | $4.99 | Unknown | Brand of the board game |
| Board Game Arena | Premium sub [V] | Publisher royalties | **Table creator only** [S] | $5/mo, $42/yr | Unknown; 10M+ users [V] | Catalogue, pandemic |
| Among Us | Paid PC + mobile ads/cosmetics [S] | | Player | $4.99 | ~$39M mobile (2020) [S] | Streamers |
| Quizizz/Wayground | District licences [V] | Teacher plans | School | Quote | Unknown | Teachers |
| Sporcle | Ads [I] | Orange ad-free sub [V] | Player | $3.99/mo | Unknown | SEO, user quizzes |
| JetPunk | Ads [S] | Premium ~$2/mo [S] | Player | $2/mo | "Barely any" from premium [S] | SEO |
| Krunker | Cosmetics + ads [S] | | Player | Microtransactions | Unknown; 200M players claimed [V] | YouTubers |
| agar.io | Ads [S] | Skins, $7.99/wk VIP (mobile) [S] | Player | | Unknown | Novelty, YouTube |
| CrazyGames / Poki | Ad rev-share [V] | IAP for selected games [V] | Advertisers | $0 | Unknown per game | Portal traffic |
| Discord Activities | Premium Apps 85/15 [V] | | Player or server | Dev sets | Unknown | In-channel presence |
| AirConsole | Hero sub [S] | **Car-maker licences** [S] | Host / OEM | $7.99/mo | Unknown | TV+phone novelty |
| Bar trivia SaaS | Monthly venue licence [S] | Setup fee | Venue | $25–199/mo | Unknown | Venue footfall |

**Patterns [I]:**
1. Ads only pay at massive scale (millions of sessions) and need the ad on the screen being looked at.
2. Ad-removal subscriptions are weak (JetPunk). Subscriptions work when the content is daily or very large (NYT,
   GeoGuessr, BGA catalogue), not for a party game used a few times a year.
3. "Host pays, guests free" is proven (Jackbox, BGA, Kahoot hosts).
4. The biggest revenue in this space is **B2B**: Kahoot work/education, AirConsole cars, bar trivia SaaS.
5. Growth came from **streamers and shareable artefacts**, not from paid marketing.

---

## 4. Recommendation for QuizNight

### 4.1 Options ranked by expected revenue vs effort (solo developer in Turkey)

Revenue figures are **order-of-magnitude guesses [I]** for year one, to compare options, not forecasts.

| Rank | Option | Fits rules? | Effort | Year-1 revenue guess | Why |
|---|---|---|---|---|---|
| **1** | **Venue licence** (cafés, bars, board-game cafés): monthly flat fee per venue, venue theme/logo, own question pool, time-metered tables (ADR-0024) | Yes: venue pays, players free, no ads | **Low**: mostly built; sales are visits | 10–30 venues × ₺1,500–2,500/mo ≈ ₺180k–900k/yr | Already have customer #1; US peers charge $149–199/mo; Istanbul pub quizzes sell ₺250 tickets, so a venue earns the fee back with a handful of guests; recurring |
| **2** | **Host web sales** via Paddle: Party Night pass ₺129 / $3.99, Lifetime ₺349 / $9.99, gifts | Yes (designed for it) | Medium: Paddle onboarding + `0009_web_purchases` integration (designed in MONETIZATION_RESEARCH §5) | Hundreds to low thousands of sales ≈ $2k–15k | Jackbox/BGA model; no ads; works worldwide through a MoR |
| **3** | **Corporate events / team building**: per-event licence (e.g. ₺5,000–15,000) with company logo theme, custom question set, team mode, an invoice | Yes | Low-medium: reuses venue theme + Custom Quiz; needs invoicing (company) | 1–3 events/month ≈ ₺60k–500k/yr | Kahoot's money is B2B; Kahoot event pass $250 [S]; HR teams have budgets |
| **4** | **Streamer mode + branded rooms**: hide room code, long timers, family filter, audience voting; later sponsored "brand nights" with a sponsor's theme and question pack | Yes, if branding stays off question screens or is static | Medium | Indirect (growth); sponsorships later, unknown | Jackbox and Gartic grew through streamers; a Turkish streamer playing with chat on phones is ideal content |
| **5** | **Category packs + host themes** (cosmetic, host-owned) | Yes: content/looks only, never power | Medium (content work) | Small add-on to #2 | Already sketched (`QUIZPARTY_PACK_<slug>`); launch only with ≥3 strong packs |
| 6 | Ads on phone lobby/results only (AdSense/AdinPlay) | Weak: KVKK consent for personalised ads, slows the join, ads on phones nobody looks at in a party | Low-medium | ~€100–300/mo at 10k impressions/day | Low CPMs (€0.25–1.2 [S]); full-screen formats gated (H5 beta); hurts the "premium party" feel (GDD) |
| 7 | CrazyGames listing of a single-screen build | Partial: needs a different mode; their SDK ads on the main screen | High | Low | Portals monetise the screen that loads the page; TV+phone does not fit; useful only as a discovery funnel later |
| 8 | Poki | No: 5–7 year web exclusivity conflicts with our domain, venue mode, Discord | High | Low | Do not sign |
| 9 | Discord Activity | Partial: own-device mode needed | High | ~0 in Turkey now | Discord blocked in Turkey since Oct 2024; revisit if it reopens |
| 10 | Schools / education licences | Yes, but KVKK children's data, MEB procurement | High, slow | Unknown | Kahoot/Wayground show it is a sales-team business |
| 11 | Player subscriptions / pay-to-win | **No** (violates rules) | n/a | n/a | Excluded |

### 4.2 The plan in one picture

- **Consumers (worldwide):** free tier (Classic, 5 rounds, no ads, no cap) → Party Night pass → Lifetime. Host only.
- **Venues (Turkey first):** monthly licence, venue theme, own questions, metered tables, winner reward (ADR-0024).
  Billing outside the app (invoice/IBAN), the app only meters time.
- **Companies:** event licence = venue theme + custom quiz + team mode for one date, invoiced.
- **Growth, not revenue:** streamer mode, a spoiler-free share card at results (Wordle lesson), free Lifetime codes
  for a few Turkish creators.
- **No ads at launch.** Revisit phone-only ads only if traffic is large (≥ 50k sessions/day) and consent is solved.

### 4.3 Suggested venue pricing (to test, not decided) [I]

| Plan | Price (KDV extra) | Includes |
|---|---|---|
| Pilot | Free for 1 month | Gusto-style setup, feedback |
| Kafe | ₺1,500 / month | 1 TV, venue theme, metered tables, rewards |
| Kafe+ | ₺2,500 / month | + own question pool, monthly themed pack, event night support |
| Etkinlik (one night) | ₺3,000–5,000 | One-off quiz night for a venue or company |

Benchmarks: US $149–199/month, EU €49–89/month [S]; Turkish purchasing power suggests far lower; ₺1,500 ≈ $30 at
~49 TRY/USD [I]. Validate with 3–5 venues before printing a price list.

### 4.4 First 3 steps

1. **Turn Gusto into a paid pilot and a template.** One-month free pilot then ₺1,500/month; a one-page agreement
   (what the venue gets, uptime, cancellation, KVKK: we store only display names of winners, ADR-0024); measure
   tables/night. Then pitch 3–5 more board-game cafés and pubs in Istanbul. This needs invoicing: the owner must
   decide with an SMMM whether to open a şahıs şirketi now (also needed for iyzico fallback).
2. **Apply to Paddle and ship web sales** as designed in `MONETIZATION_RESEARCH.md` (ask for sub-$10 pricing first).
   Keep `webPurchase` off until the sandbox tests pass.
3. **Ship two growth features:** streamer settings (hide code, extended timers, family filter) and a results share
   card (image + link, no answers revealed, ADR-0008 allow-list applies). Give free Lifetime codes to 3 Turkish
   streamers/YouTubers who already play party games.

---

## 5. Risks

- **Venue sales are manual.** Each venue is a visit, setup and support. Revenue scales with the owner's time [I].
- **Invoicing for B2B** needs a tax registration; Paddle (MoR) covers only online consumer sales. Venue and event
  income are direct Turkish sales with KDV and e-Arşiv/e-Fatura obligations (see MONETIZATION_RESEARCH §4) [I].
- **Public performance / licensing of content:** questions are ours, but music or images in themes must be licensed
  for commercial venue use [I].
- **Paddle fees on small TRY tickets** (fixed $0.50) eat ~29 % of a Party Night pass [I, MONETIZATION_RESEARCH §3.2].
- **Party games are seasonal** (Jackbox's post-lockdown slump [S]); venues and companies smooth this out.
- **Ads and KVKK:** behavioural ad cookies need explicit consent (açık rıza) per Turkish legal commentary [S]; a
  consent banner on a phone joining via QR adds friction. Another reason to skip ads.
- **Discord** status in Turkey may change; revisit if the block is lifted.
- **Branding/sponsorship** must not turn into ads on question screens; keep sponsor branding to lobby, theme and
  results, and never let a sponsor change questions' correctness or scoring [I].
- **Data gaps:** most revenue numbers in this space are private. Treat every [S]/[I] number above as a hypothesis to
  test with real venues and real buyers.

Additional KVKK sources: [FFK Partner Hukuk çerez rehberi 2026](https://www.ffkpartnerhukuk.com.tr/sirketlerde-cerez-cookie-politikasi-nasil-hazirlanir-2026-guncel-rehber-kvkk-uyumlu-cerez-politikasi-hazirlama-rehberi/) ·
[Google reklam teknolojileri](https://policies.google.com/technologies/ads?hl=tr-TR).
