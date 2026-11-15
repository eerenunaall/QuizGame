# ADR-0011: Game Director and question selection

Status: Accepted · Date: 2026-10-06

## Context
GDD §12 defines a pacing "Director" informally. Requirements: deterministic and testable, never
targets individuals, never produces unplayable content, stays inside configured bounds, and works
without live generation (questions come from the bank).

## Decision
### Interface (no player identity can enter)
```ts
director(input: DirectorInput, cfg: DirectorConfig): DirectorOutput
DirectorInput  = { roundIndex, totalRounds, level, recentCorrectPermille[], recentAvgAnswerPermille[],
                   recentRiskTakePermille[], chaos }                    // room aggregates only
DirectorOutput = { nextLevel (1000..4000 milli-levels), bucket (EASY|MEDIUM|HARD|EXPERT),
                   specialEventPermille, riskIntensity (0..3), roundKind, chaos }
```
The input schema is `.strict()` and a test asserts it contains no key that could identify a player
(`playerId`, `sessionId`, `nickname`, `score`, `rank`…) and that the output is invariant under
permutation of players. This is the structural form of "no hidden player-targeting variable".

### Behaviour (integer milli-levels, 1000 = EASY … 4000 = EXPERT)
- Window = last 3 rounds. Room correct rate ≥ 900‰ → +350 and variance ↓; 700–899 → +150;
  400–699 → hold (sweet spot); 150–399 → −150; < 150 → −300 and `chaos += 1` (comeback/wild event
  chance ↑, **never a harder question**). Level is clamped to a per-round corridor
  (`[minLevel(r), maxLevel(r)]`, e.g. no EXPERT before round 5, no EASY after round 7).
- Variance band: with high chaos the bucket may be ±1 around the target level, still inside the
  corridor, still a *calibrated* bucket – never random impossible questions.
- Category balance is not a Director input: it is applied at selection time (below). `roundKind` is chosen from the allowed kinds for that slot (STANDARD, SPEED, RISK, CROWD) by a seeded
  draw using `specialEventPermille` and hard constraints: ≤ 2 SPEED per game, ≥ 1 RISK before FINAL,
  no two specials in a row, FINAL always last. SPEED shortens the timer, never the content difficulty.
- Everything is a pure function of its input + seeded RNG.

### Deck and selection (engine stays pure)
At game start the server builds a **deck** (`DeckBuilder`, async, DB): ≈ 3× the needed questions
spread over difficulty buckets and categories, language-matched, `ACTIVE`, not expired, not used by
this host account recently, current-events pool only if enabled. The deck (including correct
answers) is stored in the private engine state. Per round the engine picks from the remaining deck
for the Director's bucket with a seeded weighted draw: avoid the previous round's category, prefer
categories with the lowest count so far, widen to adjacent buckets (bounded) if the bucket is empty,
and **never** pick below/above the corridor. If the deck is exhausted the round uses the closest
remaining question; if the deck is empty the game ends early with RESULTS (never an invalid state).
Free-tier hosts get a deck restricted to the rotating free category (ADR-0013).

## Verification
fast-check properties: output always inside bounds; level changes ≤ `maxStep` (450) per step unless the corridor itself moved; repeated failure
converges to the corridor floor but keeps buckets ≥ EASY; input has no player keys; permutation
invariance; selection never repeats a question within a game and respects the corridor.
