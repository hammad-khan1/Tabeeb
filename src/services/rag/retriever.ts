import { sql, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { embeddingProvider } from '@/lib/embeddings';
import { documents } from '../../../drizzle/schema';
import { expandQuery } from './query-expander';
import { scoreOverlap } from './reranker';

/**
 * Hybrid retrieval.
 *
 * The dense arm alone was the whole retriever, which is the wrong shape for medical
 * records: embeddings deliberately place "metformin 500mg" and "metformin 850mg"
 * close together, and drug names, strengths and lab abbreviations are exactly the
 * tokens a patient's question turns on. The lexical arm restores exact matching, and
 * the two are combined with reciprocal rank fusion.
 *
 * Recency is scored from the clinical date on the document rather than the row's
 * insert time, which made a 2015 report uploaded yesterday look maximally recent.
 *
 * On relevance floors, see MIN_SIMILARITY below: measurement showed a single cosine
 * threshold cannot separate relevant from irrelevant with this embedding model, so the
 * floor is a guard rather than a classifier.
 *
 * Two NLP steps wrap the lexical arm. The query is expanded into the vocabulary the
 * documents are likely to use before it is searched — "sugar" also searches HbA1c and
 * glucose, an Urdu question also searches its English terms — and the fused candidates
 * are then reranked on how much of that vocabulary each chunk actually contains, since
 * rank fusion by itself never looks at the text it is ranking.
 */

export interface RetrievedChunk {
  chunkId: string;
  content: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  section: string;
  relevanceScore: number;
  /** Which arm(s) surfaced this chunk — useful for debugging retrieval quality. */
  matchedBy: Array<'dense' | 'lexical'>;
  /** Query terms (expanded included) this chunk contains. */
  matchedTerms: string[];
}

interface RetrieverOptions {
  sectionFilter?: string;
  limit?: number;
  /** Set false to return whatever ranks highest regardless of the floor. */
  applyRelevanceFloor?: boolean;
}

/** Candidates pulled from each arm before fusion. */
const CANDIDATE_LIMIT = 20;
const FINAL_RESULT_LIMIT = 6;

/**
 * Absolute cosine floor. This is a degenerate-case guard, NOT a relevance classifier —
 * measured against real embeddings of this corpus, the two classes overlap:
 *
 *   RELEVANT   0.7995 .. 0.8917   (low end: "میری شوگر کتنی ہے")
 *   UNRELATED  0.7516 .. 0.8178   (high end: "best biryani recipe in Lahore")
 *
 * There is no threshold that admits every relevant query and rejects every unrelated
 * one. Worse, the overlap is not random: multilingual-e5-large scores cross-lingual
 * pairs lower than same-language pairs, so any floor high enough to reject the English
 * noise also rejects legitimate Urdu questions — the users this app exists for.
 *
 * So the floor is set below the lowest observed value of either class and only catches
 * genuinely degenerate matches. Deciding that the documents do not answer the question
 * is the model's job, and the system prompt instructs it explicitly; the lexical arm is
 * what supplies precision on exact terms.
 */
const MIN_SIMILARITY = 0.72;

/**
 * Relative floor: how far below the best dense hit a chunk may score before it is
 * dropped. Unlike the absolute floor this adapts to the query's own baseline, which is
 * what actually varies between languages.
 */
const MAX_SIMILARITY_DROP = 0.08;

const RECENCY_DECAY_DAYS = 365 * 3;

/** Standard RRF damping; keeps any single arm from dominating on rank alone. */
const RRF_K = 60;

/**
 * Weights the fused rank score against term coverage, recency and section match.
 *
 * Fusion still leads: it is the only signal that knows what the embedding model
 * thought. Coverage is second because it is the only one that reads the chunk.
 */
const WEIGHT_FUSION = 0.6;
const WEIGHT_OVERLAP = 0.2;
const WEIGHT_RECENCY = 0.12;
const WEIGHT_SECTION = 0.08;

interface CandidateRow {
  chunk_id: string;
  content: string;
  document_id: string;
  section: string | null;
  score: number;
}

function computeRecencyScore(clinicalDate: Date | null): number {
  if (!clinicalDate) return 0.5; // Undated: neither recent nor stale.
  const ageDays = (Date.now() - clinicalDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return 1;
  return Math.max(0, 1 - ageDays / RECENCY_DECAY_DAYS);
}

function computeSectionScore(chunkSection: string, querySectionFilter?: string): number {
  if (!querySectionFilter) return 0.5;
  return chunkSection.toLowerCase() === querySectionFilter.toLowerCase() ? 1 : 0;
}

/**
 * Postgres websearch_to_tsquery accepts free text safely, but an all-stopword or
 * punctuation-only query produces an empty tsquery that matches nothing — worth
 * knowing so the lexical arm can be skipped rather than silently contributing zero.
 */
function hasLexicalContent(query: string): boolean {
  return /[\p{L}\p{N}]{2,}/u.test(query);
}

async function denseCandidates(userId: string, query: string): Promise<CandidateRow[]> {
  // e5 is asymmetric: stored text is embedded as 'passage', the query as 'query'.
  const embedding = await embeddingProvider.embed(query, 'query');
  const literal = `[${embedding.join(',')}]`;

  return (await getDb().execute(sql`
    SELECT
      dc.id           AS chunk_id,
      dc.content      AS content,
      dc.document_id  AS document_id,
      dc.section      AS section,
      1 - (dc.embedding <=> ${literal}::vector) AS score
    FROM document_chunks dc
    WHERE dc.user_id = ${userId}
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${literal}::vector ASC
    LIMIT ${CANDIDATE_LIMIT}
  `)) as unknown as CandidateRow[];
}

async function lexicalCandidates(userId: string, query: string): Promise<CandidateRow[]> {
  if (!hasLexicalContent(query)) return [];

  // 'english' matches the index rebuilt in migration 0001. Stemming is applied to
  // both the query and the document, so drug names still match each other, and the
  // stopword list keeps "am I allergic to anything" from matching an unrelated chunk
  // on "I" and "to". Urdu tokenises identically under either configuration.
  //
  // The '&' → '|' rewrite matters: websearch_to_tsquery ANDs every term, so
  // "metformin dose" required both words in one chunk and returned nothing for a
  // document that plainly says "Metformin 850mg". Retrieval wants ANY term to match,
  // with ts_rank_cd deciding how good the match is. Going through
  // websearch_to_tsquery first keeps its sanitisation of user input.
  return (await getDb().execute(sql`
    WITH q AS (
      SELECT replace(websearch_to_tsquery('english', ${query})::text, '&', '|')::tsquery AS tsq
    )
    SELECT
      dc.id          AS chunk_id,
      dc.content     AS content,
      dc.document_id AS document_id,
      dc.section     AS section,
      ts_rank_cd(to_tsvector('english', dc.content), q.tsq) AS score
    FROM document_chunks dc, q
    WHERE dc.user_id = ${userId}
      AND q.tsq IS NOT NULL
      AND to_tsvector('english', dc.content) @@ q.tsq
    ORDER BY score DESC
    LIMIT ${CANDIDATE_LIMIT}
  `)) as unknown as CandidateRow[];
}

interface Fused {
  row: CandidateRow;
  rrf: number;
  similarity: number | null;
  matchedBy: Array<'dense' | 'lexical'>;
}

function fuse(dense: CandidateRow[], lexical: CandidateRow[]): Fused[] {
  const merged = new Map<string, Fused>();

  const add = (
    rows: CandidateRow[],
    arm: 'dense' | 'lexical',
    recordSimilarity: boolean
  ) => {
    rows.forEach((row, index) => {
      const existing = merged.get(row.chunk_id);
      const contribution = 1 / (RRF_K + index + 1);

      if (existing) {
        existing.rrf += contribution;
        existing.matchedBy.push(arm);
        if (recordSimilarity) existing.similarity = Number(row.score);
        return;
      }

      merged.set(row.chunk_id, {
        row,
        rrf: contribution,
        similarity: recordSimilarity ? Number(row.score) : null,
        matchedBy: [arm],
      });
    });
  };

  add(dense, 'dense', true);
  add(lexical, 'lexical', false);

  return [...merged.values()];
}

export async function retrieveRelevantChunks(
  userId: string,
  query: string,
  options?: RetrieverOptions
): Promise<RetrievedChunk[]> {
  const limit = options?.limit ?? FINAL_RESULT_LIMIT;
  const applyFloor = options?.applyRelevanceFloor ?? true;

  const trimmed = query.trim();
  if (!trimmed) return [];

  // Both arms run together; a failure in either degrades to the other rather than
  // failing the question. The lexical arm in particular must not take down chat if
  // the tsvector index is missing on an un-migrated database.
  // The expansion is for the lexical arm only: the dense arm embeds what the patient
  // wrote, and padding that text with synonyms would move the vector away from the
  // question they actually asked.
  const expanded = expandQuery(trimmed);

  const [denseResult, lexicalResult] = await Promise.allSettled([
    denseCandidates(userId, trimmed),
    lexicalCandidates(userId, expanded.lexicalQuery),
  ]);

  if (denseResult.status === 'rejected' && lexicalResult.status === 'rejected') {
    throw denseResult.reason;
  }
  if (denseResult.status === 'rejected') {
    console.warn('[Retriever] dense arm failed:', denseResult.reason);
  }
  if (lexicalResult.status === 'rejected') {
    console.warn('[Retriever] lexical arm failed:', lexicalResult.reason);
  }

  const dense = denseResult.status === 'fulfilled' ? denseResult.value : [];
  const lexical = lexicalResult.status === 'fulfilled' ? lexicalResult.value : [];

  let fused = fuse(dense, lexical);
  if (fused.length === 0) return [];

  if (applyFloor) {
    // A chunk found only by the lexical arm has no similarity score; an exact keyword
    // hit is evidence in its own right, so it is kept.
    const scored = fused
      .map((entry) => entry.similarity)
      .filter((value): value is number => value !== null);
    const bestSimilarity = scored.length > 0 ? Math.max(...scored) : null;

    fused = fused.filter((entry) => {
      if (entry.similarity === null) return true;
      if (entry.similarity < MIN_SIMILARITY) return false;
      if (bestSimilarity !== null && bestSimilarity - entry.similarity > MAX_SIMILARITY_DROP) {
        return false;
      }
      return true;
    });
    if (fused.length === 0) return [];
  }

  const documentIds = [...new Set(fused.map((entry) => entry.row.document_id))];
  const docRows = await getDb()
    .select({
      id: documents.id,
      title: documents.title,
      documentType: documents.documentType,
      documentDate: documents.documentDate,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(inArray(documents.id, documentIds));

  const docMap = new Map(docRows.map((doc) => [doc.id, doc]));

  // RRF scores are tiny and unbounded above; normalizing against the best in this
  // result set keeps the blend with recency and section meaningful.
  const bestRrf = Math.max(...fused.map((entry) => entry.rrf));

  const scored: RetrievedChunk[] = fused.map((entry) => {
    const doc = docMap.get(entry.row.document_id);
    // The clinical date is what "recent" means to a patient; createdAt is only a
    // fallback for documents whose date could not be read.
    const clinicalDate = doc?.documentDate ?? doc?.createdAt ?? null;
    const section = entry.row.section ?? 'General';

    const overlap = scoreOverlap(expanded.terms, entry.row.content);

    const relevanceScore =
      WEIGHT_FUSION * (entry.rrf / bestRrf) +
      WEIGHT_OVERLAP * overlap.coverage +
      WEIGHT_RECENCY * computeRecencyScore(clinicalDate) +
      WEIGHT_SECTION * computeSectionScore(section, options?.sectionFilter);

    return {
      chunkId: entry.row.chunk_id,
      content: entry.row.content,
      documentId: entry.row.document_id,
      documentTitle: doc?.title ?? 'Unknown',
      documentType: doc?.documentType ?? 'other',
      section,
      relevanceScore,
      matchedBy: [...new Set(entry.matchedBy)],
      matchedTerms: overlap.matched,
    };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored.slice(0, limit);
}
