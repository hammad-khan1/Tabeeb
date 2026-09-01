import { sql, eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { embeddingProvider } from '@/lib/embeddings';
import { documentChunks, documents } from '../../../drizzle/schema';

export interface RetrievedChunk {
  chunkId: string;
  content: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  section: string;
  relevanceScore: number;
}

interface RetrieverOptions {
  sectionFilter?: string;
  limit?: number;
}

const SIMILARITY_FETCH_LIMIT = 15;
const FINAL_RESULT_LIMIT = 6;
const RECENCY_DECAY_DAYS = 365;

function computeRecencyScore(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - ageDays / RECENCY_DECAY_DAYS);
}

function computeSectionScore(chunkSection: string, querySectionFilter?: string): number {
  if (!querySectionFilter) return 0.5;
  return chunkSection.toLowerCase() === querySectionFilter.toLowerCase() ? 1 : 0;
}

export async function retrieveRelevantChunks(
  userId: string,
  query: string,
  options?: RetrieverOptions
): Promise<RetrievedChunk[]> {
  const limit = options?.limit ?? FINAL_RESULT_LIMIT;
  const queryEmbedding = await embeddingProvider.embed(query);
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  const similarityQuery = sql`
    SELECT
      dc.id AS chunk_id,
      dc.content,
      dc.document_id,
      dc.section,
      dc.created_at,
      1 - (dc.embedding <=> ${embeddingLiteral}::vector) AS similarity
    FROM document_chunks dc
    WHERE dc.user_id = ${userId}
    ORDER BY dc.embedding <=> ${embeddingLiteral}::vector ASC
    LIMIT ${SIMILARITY_FETCH_LIMIT}
  `;

  const rows = await getDb().execute(similarityQuery) as Array<{
    chunk_id: string;
    content: string;
    document_id: string;
    section: string | null;
    created_at: string;
    similarity: number;
  }>;

  if (rows.length === 0) return [];

  const documentIds = [...new Set(rows.map((r) => r.document_id))];
  const docRows = await getDb()    .select({
      id: documents.id,
      title: documents.title,
      documentType: documents.documentType,
    })
    .from(documents)
    .where(
      documentIds.length === 1
        ? eq(documents.id, documentIds[0])
        : sql`${documents.id} IN (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)})`
    );

  const docMap = new Map(docRows.map((d) => [d.id, d]));

  const scored = rows.map((row) => {
    const similarity = Number(row.similarity);
    const recency = computeRecencyScore(new Date(row.created_at));
    const sectionMatch = computeSectionScore(row.section ?? '', options?.sectionFilter);
    const relevanceScore = 0.7 * similarity + 0.2 * recency + 0.1 * sectionMatch;

    const doc = docMap.get(row.document_id);
    return {
      chunkId: row.chunk_id,
      content: row.content,
      documentId: row.document_id,
      documentTitle: doc?.title ?? 'Unknown',
      documentType: doc?.documentType ?? 'other',
      section: row.section ?? 'General',
      relevanceScore,
    };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored.slice(0, limit);
}
