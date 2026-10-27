# Themes: colour research, decisions and how to use them

Status: implemented (web). Queued item in `docs/PLAN.md`. Tokens: `packages/ui-tokens/src/themes.ts`;
red-team: `packages/ui-tokens/src/themes.test.ts`.

## 1. Research and honest confidence

Colour psychology is weak evidence. Lab studies use still colour patches, small samples and disagree
on hue effects. Marketing claims ("red converts", "gold feels premium") are mostly unreplicated
folklore; we used them only as tie-breakers, never as a reason to hurt legibility.

| Topic | Finding | Confidence | Source |
| --- | --- | --- | --- |
| Energy / arousal | Higher saturation and brightness raise self-reported and physiological arousal; the hue ranking (red highest) is not consistent across studies (an older study ranked green-yellow highest). N = 62 in the newer one. | Medium for saturation/brightness, low for hue | [Color and emotion: hue, saturation, brightness](https://pubmed.ncbi.nlm.nih.gov/28612080/); [Effects of color on emotions](https://pubmed.ncbi.nlm.nih.gov/7996122/) |
| Field quality | A critical review notes uneven rigour in colour-emotion work; no meta-analysis found for games. | High that evidence is thin | [Color psychology: a critical review](https://pubmed.ncbi.nlm.nih.gov/2289687/) |
| In games | Luminance/saturation correlate with reported joy/fear in game images (85 participants, correlational). | Low | [How Color Properties Can Be Used to Elicit Emotions in Video Games](https://oskar-bordeaux.fr/handle/20.500.12278/77609) |
| Contrast | Text 4.5:1 (large 3:1) and UI components/graphics 3:1 are the WCAG AA bars. Do not round (4.499 fails). | High (standard) | [Understanding SC 1.4.3](https://w3c.github.io/wcag/understanding/contrast-minimum); [WebAIM contrast](https://webaim.org/articles/contrast/) |
| TV safe area | Text should stay inside the central ~90% (Xbox, BBC), older broadcast title-safe is 80%; flat panels reduce but do not remove overscan. Sources disagree on numbers. | Medium | [Xbox screen areas](https://devdocs.xbox.com/build/core-features/graphics/overviews/screen-areas); [Maya safe regions](https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-13D613FF-994F-480A-AF0E-DFE06418A351.htm) |
| Colour-blind safety | The Okabe-Ito palette is the common colour-universal-design set (#E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7). Evidence here is secondary guides, no formal user study found; always simulate. | Medium | [factoextra palette docs](https://rdrr.io/cran/factoextra/man/factoextra_palette.html); [cvdsafe](https://pypi.org/project/cvdsafe/) |
| Dark vs light | Positive polarity (dark text on light) tends to win for small text and in the dark for normal vision; comfort/fatigue results are mixed; dark helps some low-vision users. Secondary write-ups only. | Low to medium | [NN/g dark mode](https://www.nngroup.com/articles/dark-mode/) |
| Gold on black "premium" | No credible study found. Treated as a brand convention, not evidence. | Very low | none |

Not found by search: viewing-distance rules for TV text and glare studies. Our TV rules below are
engineering judgement (large type already used; strict contrast margin), flagged as such.

## 2. Decisions

1. **Keep dark stages for all themes.** The TV is the stage in a dim living room or bar; a bright
   panel causes glare and washes out in ambient light, and the game text is large (the small-text
   polarity advantage does not apply). Low confidence either way; documented, not proven.
2. **`party`** is untouched (navy, gold, violet, vivid answers). Its answer colours red/green are 10.0 delta-E
   apart under deuteranopia, below the 25 bar of the new themes; answers keep a letter and shape, so
   it is accepted and explicitly exempted in the test (`ANSWER_MIN_LEGACY`).
3. **`venue-gold`**: near-black warm charcoal, gold `#d4af37` primary, bronze `#7d5a1c` secondary
   (white label 4.5:1+), champagne text. Placeholder colours: the owner's brand codes replace them.
4. **`high-contrast`**: pure black, white text, borders `#bdbdbd`, yellow primary. Intended for
   glare, old TVs and low vision.
5. **Colour-blind safe answers and categories** in both new themes derive from Okabe-Ito, then
   lightened so black labels pass 4.5:1 on the glossy cards (`--qp-color-on-answer`).
6. Eight **category colours** (`--qp-color-category-1..8`) per theme, never the only cue (icon and
   name stay). The existing category badge PNGs are fixed artwork and are not recoloured per theme.
7. Confetti and browser-chrome colour follow the theme. Safe area: keep text within 90% (existing
   TvFrame padding; verify on real TVs, see owner list).

## 3. Red-team thresholds (unit tests)

- Text tokens (`text`, `mutedText`) >= 4.5:1 on all four surfaces; button labels >= 4.5:1 on the
  darker glossy fill (party danger label and answer labels are exempt/2.2, legacy).
- UI tokens (accents, status, answers, categories, players, `surfaceLine`) >= 3:1 on background
  (party `surfaceLine` is decorative and exempt).
- CVD: Machado et al. 2009 full-severity deuteranopia/protanopia matrices in linear RGB, CIE76
  delta-E. Categories >= 15 (a just-noticeable difference is about 2.3, so 15 is "clearly
  different at a glance"; chosen as the strictest bar the 8-colour sets meet with margin).
  Answers >= 25 in new themes. CIE76 is a crude metric and the simulation models dichromacy, not
  milder anomalies; real-person testing is still needed.
- Measured minima (cat/answers): party deut 18.8/10.0, prot 16.7/26.7; venue-gold deut 18.0/27.9,
  prot 16.5/28.8; high-contrast identical to gold on those.

## 4. Using themes

- `?theme=party|venue-gold|high-contrast` on any URL (remembered per device in `qp.prefs`).
- Deployment default: `VITE_DEFAULT_THEME=venue-gold`.
- TV title screen, Settings, "Theme" row.
- Venue logo slot (top-left of the TV bar): `VITE_VENUE_LOGO_URL=/venue/logo.svg` (file in
  `apps/web/public/venue/`). Empty means nothing is shown; no logo is invented. Only same-origin
  or https `.svg/.png/.webp` accepted.

## 5. Needed from the owner

Venue logo (SVG), exact brand colour codes (gold, black, accents), brand font (must cover Turkish
letters Ş Ğ İ), audience type, and a real-TV check of glare/overscan and a colour-blind tester.
