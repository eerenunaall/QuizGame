/**
 * Pure settlement rules for Pot and Duel (ADR-0023, research R5 and R2). Both only move points between
 * the players who opted in, so the totals in a room never change: no inflation, no hidden creation.
 */

export interface PotEntry {
  playerId: string;
  correct: boolean;
  /** Milliseconds after the window opened at which the answer was accepted (smaller = faster). */
  offsetMs: number;
  joinIndex: number;
}

export interface PotSettlement {
  /** Everything anted in. */
  size: number;
  /** What each entrant gets back out of the pot (the ante itself on a refund). */
  payouts: Record<string, number>;
  winnerIds: string[];
  /** Nobody was right: every ante is handed back. */
  refunded: boolean;
}

/**
 * Splits the pot equally between the right answers, the remainder going to the fastest of them (ties by
 * seat). `entries` are the players whose ante was taken; the caller decides whether a pot runs at all
 * (enough players) and subtracts the antes. Nobody right: everyone gets their ante back.
 */
export function settlePot(entries: readonly PotEntry[], ante: number): PotSettlement {
  const size = ante * entries.length;
  const winners = entries
    .filter((entry) => entry.correct)
    .sort((a, b) => a.offsetMs - b.offsetMs || a.joinIndex - b.joinIndex);
  const payouts: Record<string, number> = Object.fromEntries(entries.map((e) => [e.playerId, 0]));
  if (winners.length === 0) {
    for (const entry of entries) payouts[entry.playerId] = ante;
    return { size, payouts, winnerIds: [], refunded: true };
  }
  const share = Math.floor(size / winners.length);
  const remainder = size - share * winners.length;
  for (const winner of winners) payouts[winner.playerId] = share;
  payouts[winners[0]!.playerId] = share + remainder;
  return { size, payouts, winnerIds: winners.map((w) => w.playerId), refunded: false };
}

export interface DuelSide {
  playerId: string;
  correct: boolean;
  /** Null when the player never answered (counts as wrong). */
  offsetMs: number | null;
}

export interface DuelResult {
  winnerId: string | null;
  /** Points to move from the other side to the winner, before the loser's balance caps them. */
  points: number;
}

/**
 * Exactly one side right: that side takes `win`. Both right: the faster takes `bothRight` (a tie takes
 * nothing). Both wrong or unanswered: nothing.
 */
export function resolveDuel(
  a: DuelSide,
  b: DuelSide,
  rules: { win: number; bothRight: number },
): DuelResult {
  if (a.correct && !b.correct) return { winnerId: a.playerId, points: rules.win };
  if (b.correct && !a.correct) return { winnerId: b.playerId, points: rules.win };
  if (a.correct && b.correct && a.offsetMs !== null && b.offsetMs !== null) {
    if (a.offsetMs < b.offsetMs) return { winnerId: a.playerId, points: rules.bothRight };
    if (b.offsetMs < a.offsetMs) return { winnerId: b.playerId, points: rules.bothRight };
  }
  return { winnerId: null, points: 0 };
}
