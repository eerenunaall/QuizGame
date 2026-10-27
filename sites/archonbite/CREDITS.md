# Credits and licences

Everything on this site is either original to Archonbite / the QuizNight project, or an open-licensed font listed here.
**No stock photos, no icon packs, no third-party scripts, no trackers.** If you add anything third-party, record it here
with its licence; if you cannot verify a licence, do not use the asset.

## Fonts (self-hosted, SIL Open Font License 1.1)

| Font | Used for | Copyright | Where the files came from |
| --- | --- | --- | --- |
| Bricolage Grotesque (variable, weight axis) | Headings and the wordmark | © 2022 The Bricolage Grotesque Project Authors (github.com/ateliertriay/bricolage) | `@fontsource-variable/bricolage-grotesque` 5.3.0 on the npm registry |
| Inter (variable, weight axis) | Body text and interface | © 2016 The Inter Project Authors (github.com/rsms/inter) | `@fontsource-variable/inter` 5.3.0 on the npm registry |

The original files were reduced with fonttools (`pyftsubset`) to Basic Latin, Latin-1 and Latin Extended-A (this covers the
Turkish letters ç ğ ı İ ö ş ü) plus common punctuation, and re-packed as WOFF2. The full licence texts are in
`assets/fonts/OFL-Bricolage-Grotesque.txt` and `assets/fonts/OFL-Inter.txt`. Reserved Font Names are not used for any
derived product name.

## Original artwork (made for this site, no third-party material)

| Asset | How it was made |
| --- | --- |
| Archonbite mark, favicon, app icons (`assets/img/mark.svg`, `favicon.svg`, `favicon-32.png`, `icon-*.png`, `apple-touch-icon.png`) | Hand-drawn SVG paths; PNGs rendered from the SVG |
| Home hero layers (`assets/img/hero-*.svg`, `grain.svg`) | Generated SVG by `tools/gen-hero-art.mjs` |
| Salty Pirate placeholder art (`assets/salty-pirate/*.svg`) | Generated SVG by `tools/gen-salty-art.mjs`. **Placeholder only**; generic pirate-sea scenery, not from the real game |
| Share images (`assets/img/og-*.jpg`), QuizNight key art, capsule, square (`assets/quiznight/key-art.jpg`, `capsule.jpg`, `square.jpg`) | Composed by `tools/make-art.mjs` from the assets in this table and the QuizNight screenshots below |
| Interface icons (inline in `assets/app.js`) | Simple line icons drawn for this site |

## QuizNight material

| Asset | Source |
| --- | --- |
| `assets/quiznight/tv-*.webp`, `phone-*.webp`, `en-tv-lobby.webp` | Real screenshots of the QuizNight web app (this repository, `apps/web`), captured with headless Chromium while playing a real game with four simulated players (party theme and the café "gusto" theme). The game's own avatars, stickers and mascot in them belong to the QuizNight project. The only edit: the join address printed under the QR code was changed to `quiz.archonbite.com` (the local test address was shown). |
| `assets/quiznight/logo.webp`, `mascot.webp` | The QuizNight logo and party-cone mascot from `docs/design/brand/source/` in this repository (the owner's brand assets), re-sized and converted to WebP |
| `assets/quiznight/tv-gusto.webp` | Café theme screenshot; it shows the logo of **Gusto Board Game Cafe** (first venue partner). **TODO-OWNER: confirm the venue's permission to show its logo publicly, or remove this image.** |

Facts about the game on the guide and store pages come from this repository's documentation (`docs/GDD.md`,
`docs/VENUE.md`, `docs/STATUS.md`) and from `packages/game-engine/src/config.ts` (timers, points, limits).

## Trademarks

QuizNight, Salty Pirate and Archonbite are names used by the studio. Other product and company names that may appear
(for example Gusto Board Game Cafe, YouTube) belong to their owners and are used only to identify them.

## Salty Pirate fonts (added)

| Font | Use | Licence |
| --- | --- | --- |
| Pirata One | Salty Pirate page headings | SIL Open Font License 1.1 (Google Fonts), self-hosted `assets/fonts/pirata-one-latin.woff2` |
| Cormorant Garamond (variable) | Salty Pirate page text | © 2015 The Cormorant Project Authors, SIL OFL 1.1, `assets/fonts/cormorant-latin.woff2`; licence text in `assets/fonts/OFL-PirataOne-Cormorant.txt` |
