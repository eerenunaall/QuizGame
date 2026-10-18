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

## Not judged / limits

- Real TV glare, panel overscan, viewing distance, colour-blind perception and sound: need a real device.
- English games could not be played in the sandbox (seed question bank is Turkish); English screens were
  checked for title and lobby only.
- Extremely long custom questions (> ~160 characters) were rejected by the server (`TOO_LONG`), so the
  smallest question font step was not seen with real content.
- Body text target of 28 px at 1080p holds for answers, names and lobby copy; small labels (badges,
  difficulty chip) stay at 24-26 px by design.
