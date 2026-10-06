# ADR-0020: Visual direction, asset sources and the settings the mockup implies

Status: Accepted · Date: 2026-10-06

## Context
The owner shared a mood mockup (`docs/design/owner-reference-mockup.webp`): a dark game-show stage,
chunky coloured answer cards with letter badges, avatar rings with a host crown, a QR + room code
join screen, a category grid with question-count and difficulty pills, a "final round ×2" splash
and a phone controller with full-width answer buttons. The brief for it is **inspiration, not a
copy**, and the owner authorised sourcing PNGs and animations from wherever is needed. GDD §14.1
asks for "modern game-show, arcade energy, premium party game, dark stage, bright accent colours,
large typography, expressive avatars, particles/confetti, dramatic countdown"; GDD §33 fixes the
token vocabulary (background, surface, text, mutedText, accentA/B, success, danger, warning,
player1…8).

## Decisions
**1. Look.** Deep-navy "stage" background with soft light pools, gold (`accentA`) for the primary
call to action, violet (`accentB`) for secondary actions and the leader highlight, and four answer
colours — red, blue, amber, green — each with a **letter badge** so colour is never the only cue
(GDD §14.2). Original wordmark, no mascots or logos from the mockup, brand name stays "Quiz Party"
(one constant, `brand.name`).

**2. Art.** No hand-drawn or AI art is invented here. Sources, all reachable from the build
environment and permissively licensed:
- Microsoft *Fluent Emoji* 3D (MIT) — 24 avatars, 54 stickers, category icons;
- Google *Noto Emoji animations* (CC BY 4.0) — 20 frame-animated reactions for big moments;
- everything else is CSS/SVG motion (transform/opacity only) and `canvas-confetti` (ISC).
`scripts/assets/manifest.ts` is the single list of what is bundled and where it came from;
`pnpm assets:build` regenerates `apps/web/src/assets/**`, `NOTICE.md` and the credits data. The
outputs are committed so builds never need the network. Budgets: avatar ≤ 10 KiB, sticker ≤ 14 KiB,
animation ≤ 110 KiB (whole animated pack ≤ 1.4 MiB, loaded lazily). The app ships a credits page.
Art can be swapped for commissioned illustrations later by replacing files of the same id.

**3. Motion.** Only `transform`/`opacity`; one `requestAnimationFrame` loop per screen for the
countdown ring and score counters (no per-tick React renders); `prefers-reduced-motion` and the TV
capability gate switch decorative loops off; animated assets are decorative (`alt=""`).

**4. Behaviour the mockup suggests, decided here.**
| Mockup | Decision | Why |
|---|---|---|
| TV shows each player's chosen letter while answering | TV shows only "answered ✓"; choices appear in the reveal | everyone in the room can see the TV: showing choices invites copying (GDD §11) |
| Question counts 10 / 15 / 20 | `rounds` 3–20, default 10 (GDD §7.1); free tier 5 | GDD default kept, longer games offered |
| Difficulty Kolay / Orta / Zor | `difficulty` lobby setting; shifts the director's level and corridors by −400 / 0 / +400 milli-levels | the director keeps adapting inside the chosen band; still no per-player targeting (ADR-0011) |
| "Final: last 5 questions, points ×2" | Final stage = the last `clamp(floor(total/3), 1, 5)` questions (3 of 10, 5 of 15/20, 1 of ≤5), each `FINAL` kind (2× base and speed points); the "Final" splash plays once, before the first | GDD §7.10 wants a final that "feels different"; the owner's picture makes it a stage rather than one question |
| "Sonraki Soru →" button | timed auto-advance; no button on the TV | a party game must not stall on a remote |
| 12 category tiles incl. Karışık / Özel Quiz | tiles come from `GET /v1/categories`; Karışık = `ALL`; Özel Quiz appears with M5 | the bank, not the client, owns the taxonomy |

## Consequences
- Protocol: `LobbySettings.difficulty`, `rounds` up to 20, `RoundPublic.finalStage`, `RoomView.limits`,
  24 avatar ids. Engine config gains `maxRounds`, `finalStage`, `director.presetOffset`.
- ADR-0007 "final = last round" becomes "final = last stage"; the mandatory stake ladder (M2) applies
  to the last final question only, so a final stage of five does not become a coin flip.
- Credits/licence notices are a release-checklist item.

## Amendment (M1c): reveal and layout details settled while building the screens
- **"Biliyor muydunuz?"** — when a question has an explanation, the reveal turns the question card
  into an explanation card after the answer highlight (≈ 1.9 s). The reveal lasts
  `revealMs + min(explanation.length × revealPerCharMs, revealExplanationMaxMs)` (4.5 s + up to 5 s
  at 35 ms per character) so there is time to read it; no explanation → no extra time.
- **Faces on the reveal** — at most three faces per answer card, the rest folded into a "+N" chip, so
  an answer text never loses its room; answer text steps down by length (never below 28 px at 1080p).
- **Crown** — shown for the player who leads *with points* only (a 0–0 tie has no leader), and it
  moves to the new leader when the score rows settle.
- **Eight players** — score rows shrink to fit (`rowHeightFor`), the bottom strip holds eight tiles,
  the lobby grid shows eight slots.
- **Leader tools in the lobby** — the leader can hand over leadership or remove a player from the
  phone (removal needs a second, confirming tap).
