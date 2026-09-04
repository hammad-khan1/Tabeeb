import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseSearchParams, searchSchema } from '@/lib/validation';
import { retrieveRelevantChunks } from '@/services/rag/retriever';

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('search', userId);

    // `limit` is validated rather than passed through parseInt: `?limit=abc` produced
    // NaN and `slice(0, NaN)`, so search silently returned nothing.
    const { q, section, limit } = parseSearchParams(searchSchema, request.nextUrl.searchParams);

    const results = await retrieveRelevantChunks(userId, q, {
      limit,
      sectionFilter: section,
    });

    return NextResponse.json({ query: q, results, count: results.length });
  } catch (error) {
    return errorResponse('GET /api/search', error, 'Search failed');
  }
}
