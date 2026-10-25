/**
 * Anti-boredom ranking for a venue's decks (ADR-0025 §9). A café's regulars play the same TV week after
 * week; the deck builder must not hand them the questions they just had. Pure: the history, the clock's
 * timestamps and the randomness are arguments, so the rule is tested without a database.
 */
export interface FreshCandidate {
  id: string;
  category: string;
}

export interface FreshHistoryEntry {
  id: string;
  category: string;
  /** When the venue last played the question (epoch ms). */
  playedAt: number;
}

export interface FreshOptions {
  /** How many of a category's most recently played distinct questions count as "recent". */
  window: number;
  /** Uniform in [0, 1). Injected so tests are deterministic. */
  random: () => number;
}

/** The ids that are recent for the venue: per category, the `window` most recently played. */
export function recentIds(
  history: readonly FreshHistoryEntry[],
  window: number,
): Map<string, number> {
  const byCategory = new Map<string, FreshHistoryEntry[]>();
  for (const entry of history) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }
  const recent = new Map<string, number>();
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.playedAt - a.playedAt || (a.id < b.id ? -1 : 1));
    for (const entry of list.slice(0, Math.max(0, window))) recent.set(entry.id, entry.playedAt);
  }
  return recent;
}

/**
 * Candidates best first. Questions that are not recent for this venue come first, in random order;
 * recent ones follow, the longest unplayed first. A small pool therefore degrades into "oldest played
 * first" instead of failing: the result always contains every candidate, so a game is never blocked.
 */
export function rankFresh(
  candidates: readonly FreshCandidate[],
  history: readonly FreshHistoryEntry[],
  options: FreshOptions,
): string[] {
  const recent = recentIds(history, options.window);
  const keyed = candidates.map((candidate) => ({
    id: candidate.id,
    playedAt: recent.get(candidate.id) ?? null,
    tie: options.random(),
  }));
  const fresh = keyed.filter((item) => item.playedAt === null).sort((a, b) => a.tie - b.tie);
  const stale = keyed
    .filter((item) => item.playedAt !== null)
    .sort((a, b) => a.playedAt! - b.playedAt! || a.tie - b.tie);
  return [...fresh, ...stale].map((item) => item.id);
}
