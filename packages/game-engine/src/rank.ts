export interface RankInput {
  playerId: string;
  score: number;
  correctCount: number;
  totalRemainingMs: number;
  joinIndex: number;
}

export interface Ranked extends RankInput {
  rank: number;
}

/**
 * Orders by score, then correct answers, then total time left, then join order (ADR-0007).
 * Players equal on score, correct answers and time left share a rank (competition ranking:
 * 1, 1, 3); join order only decides list order.
 */
export function rankPlayers(players: readonly RankInput[]): Ranked[] {
  const sorted = players
    .slice()
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.correctCount - a.correctCount ||
        b.totalRemainingMs - a.totalRemainingMs ||
        a.joinIndex - b.joinIndex,
    );
  const out: Ranked[] = [];
  sorted.forEach((player, index) => {
    const previous = out[index - 1];
    const tied =
      previous !== undefined &&
      previous.score === player.score &&
      previous.correctCount === player.correctCount &&
      previous.totalRemainingMs === player.totalRemainingMs;
    out.push({ ...player, rank: tied && previous ? previous.rank : index + 1 });
  });
  return out;
}
