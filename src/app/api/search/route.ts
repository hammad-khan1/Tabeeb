import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { retrieveRelevantChunks } from '@/services/rag/retriever';

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const query = request.nextUrl.searchParams.get('q');

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter q is required' },
        { status: 400 }
      );
    }

    const limitParam = request.nextUrl.searchParams.get('limit');
    const sectionFilter = request.nextUrl.searchParams.get('section') ?? undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const results = await retrieveRelevantChunks(userId, query, {
      limit,
      sectionFilter,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Search failed';
    console.error('[GET /api/search]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
