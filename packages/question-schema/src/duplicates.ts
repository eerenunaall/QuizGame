import { finding, type Finding } from './findings';
import type { HeuristicConfig } from './heuristics';
import type { MemorySimilarityIndex, SimilarityEntry } from './similarity';

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Looks one question up in the duplicate index (GDD §9.9, three approaches): exact lexical
 * fingerprint, MinHash similarity, vector proxy. The thresholds are configuration. Only
 * near-identical text is a REJECT; anything weaker is a REVIEW for an editor, because two
 * questions can share a template and still be different facts.
 */
export function duplicateFindings(
  entry: SimilarityEntry,
  index: MemorySimilarityIndex,
  thresholds: HeuristicConfig['duplicate'],
): Finding[] {
  const same = index.findLexical(entry.language, entry.lexical);
  if (same && same.id !== entry.id) {
    return [
      finding(
        same.correctKey === entry.correctKey ? 'DUPLICATE_LEXICAL' : 'CONFLICTING_DUPLICATE',
        {
          otherId: same.id,
        },
      ),
    ];
  }
  const [top] = index.nearest(entry, {
    minJaccard: thresholds.reviewJaccard,
    minCosine: thresholds.reviewCosine,
    limit: 3,
  });
  if (!top) return [];
  const detail = {
    otherId: top.id,
    jaccard: round(top.jaccard),
    ...(top.cosine === null ? {} : { cosine: round(top.cosine) }),
    sameAnswer: top.sameAnswer,
  };
  if (top.jaccard >= thresholds.rejectJaccard) return [finding('NEAR_DUPLICATE', detail)];
  if (top.jaccard >= thresholds.reviewJaccard) return [finding('SIMILAR_QUESTION', detail)];
  return [finding('POSSIBLE_SEMANTIC_DUPLICATE', detail)];
}
