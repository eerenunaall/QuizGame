# Visual QA pass (demo readiness)

Method: Playwright (Chromium) drove real games and screenshots were reviewed by eye. TV 1920x1080 and
1366x768, phone 390x844, 360x740 and landscape 844x390; themes party, venue-gold, high-contrast;
screens: title, lobby (8 players, long Turkish names), question, reveal, power moment, score, results,
unlock, Who Said It, Blind. Measurements that are deterministic live in `tests/e2e/visual-qa.spec.ts`.

## Fixed

- Join page: the sixth avatar column was cut off at 360-390 px (grid `1fr` never shrank); now 6 columns
  of >= 48 px targets.
- Turkish glyphs: `overflow: hidden` name boxes clipped the cedilla of Ş/ş (and risked the dot of İ).
  They now carry vertical padding.
- TV overscan: the player strip scores sat at y=1066, results buttons at 1045, the 8-player lobby
  summary at 1058. All text is now inside the central 90%; asserted for title and an 8-player lobby.
- Lobby text raised to 28 px where it was 26 px; the lobby sparkle sticker no longer collides with the
  title hint and the start button.
- Themes: the violet light beams, navy panels and the violet first-place row ignored the theme. Gold is
  now warm, high-contrast pure black (no beams), panels use theme tints (`--qp-deep-rgb`,
  `--qp-surface-rgb`, `--qp-first-*`). Party values are unchanged.
- Landscape phone: answers sit in a 2x2 grid so all four fit without scrolling; compact outcome art.
- First-time experience: one sentence under the TV title buttons and under the phone join heading,
  Turkish and English (`tv.menu.firstTime`, `join.howto`).

## Added polish (CSS only, off under `data-motion='low'` and `prefers-reduced-motion`)

- `qp-bloop` squash-and-pop when an answer is tapped; `qp-correct-pop` before the pulse on the right card.
- Mascot cheers on the TV results and on a right answer / first place on the phone; a QuizNight letter
  character hops in beside "correct answer" on the TV (`LetterCheer`).

## Show motion pass (sound + choreography, see docs/AUDIO.md)

`tests/e2e/show.spec.ts` plays a full game (TV + three phones, one of them right every time so a streak
builds) and photographs the key moments into `test-results/screenshots/show-*.png`. A moving screen is
photographed deterministically: every running animation is frozen at a chosen time (Web Animations API
`pause()` + `currentTime`), so "300 ms into the reveal" is the same frame on every run.

States to look at (TV 1920x1080 unless noted): lobby arrival (avatar mid-pop with its halo), countdown, phone
locked (stamp), TV and phone in the last 3 s (vignette, pulse ring, red timer), reveal at 300 ms (roll: nothing
decided yet), 800 ms (wrong options dimming one by one), 1450 ms (right card popped, frame, burst, faces,
badges), 2200 ms (explanation card), streak rounds (flame on the strip, combo corner on the TV, combo toast on
the phone), score at 700 ms (bars growing) and settled (climbers pulsing), podium at 0.7 s / 1.5 s / 2.9 s /
4.5 s, phone reveal at 300 ms (roll dots) and 1500 ms (verdict), phone results.

Measured, not photographed: TV text stays inside the central 90% during lobby, urgency, reveal, score and
podium; the streak flame and the combo corner appear at the right streak (flame from 2, TV corner from 3);
with `prefers-reduced-motion` nothing loops, the right answer is highlighted and the text is still inside the
safe area; at 4x CPU throttling the frames keep coming (p95 gap under 160 ms in headless software rendering).

Fixed on the way: the player strip's score text box ended at 1030 px (the strip's bottom padding is now 60 px
so it ends at 1020, inside the 5% safe area); the new score bars are tinted with the player's colour (a gold
bar on navy read as mud); the reveal's right-answer frame moved from a box-shadow that appeared at once to a
ring that arrives with the drum hit.

## Not judged / limits

- Real TV glare, panel overscan, viewing distance, colour-blind perception and sound: need a real device.
  The sound palette was measured (peak, loudness, 0.5-4 kHz energy, no clipping) but nobody has listened to it
  on a TV speaker in a noisy room yet: `pnpm audio:render -- --wav <dir>` writes a soundboard to try.
- English games could not be played in the sandbox (seed question bank is Turkish); English screens were
  checked for title and lobby only.
- Extremely long custom questions (> ~160 characters) were rejected by the server (`TOO_LONG`), so the
  smallest question font step was not seen with real content.
- Body text target of 28 px at 1080p holds for answers, names and lobby copy; small labels (badges,
  difficulty chip) stay at 24-26 px by design.
