/**
 * Lexical reranking over the fused candidate set.
 *
 * Reciprocal rank fusion is deliberately blind to content: it only knows what position
 * each arm put a chunk in, so a chunk that ranked third in both arms outranks one that
 * contains every word of the question but surfaced in only one. After expansion the
 * query carries the document's own vocabulary, which makes a content check worth doing.
 *
 * A cross-encoder is the usual tool here and is not an option: it is a model download
 * and a GPU-shaped latency budget on a request that must answer a patient in seconds.
 * This is the cheap, honest version — term coverage weighted towards rare terms, plus
 * a bonus for the exact numbers and strengths a patient asks about — computed in
 * microseconds with no dependency at all.
 */

import { contentTerms } from './query-expander';

/**
 * Longer terms carry more information: "metformin" separates documents, "test" does
 * not. Length is a crude stand-in for inverse document frequency, but it needs no
 * corpus statistics and no index — and it is right about the cases that matter here.
 */
function termWeight(term: string): number {
  if (/\d/.test(term)) return 2; // Numbers: a dose or a lab value the patient named.
  if (term.length >= 8) return 1.5;
  if (term.length >= 5) return 1.2;
  return 1;
}

export interface OverlapScore {
  /** 0-1 share of the query's weighted terms present in the chunk. */
  coverage: number;
  /** The query terms that matched, for debugging retrieval quality. */
  matched: string[];
}

/**
 * How much of the query this chunk actually contains.
 *
 * Matching is prefix-based in one direction only: a chunk term counts for a query term
 * when it starts with it ("metformin" matches "metformin,", "500mg" matches "500"), so
 * stemming and punctuation do not cost a match, while unrelated words that merely share
 * a prefix with a short query term are held off by the minimum length.
 */
const MIN_PREFIX_LENGTH = 4;

export function scoreOverlap(queryTerms: string[], content: string): OverlapScore {
  const unique = [...new Set(queryTerms)].filter(Boolean);
  if (unique.length === 0) return { coverage: 0, matched: [] };

  const chunkTerms = new Set(contentTerms(content));
  const chunkArray = [...chunkTerms];

  let total = 0;
  let hit = 0;
  const matched: string[] = [];

  for (const term of unique) {
    const weight = termWeight(term);
    total += weight;

    const isMatch =
      chunkTerms.has(term) ||
      (term.length >= MIN_PREFIX_LENGTH && chunkArray.some((word) => word.startsWith(term)));

    if (isMatch) {
      hit += weight;
      matched.push(term);
    }
  }

  return { coverage: total === 0 ? 0 : hit / total, matched };
}
