import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { checkInteractions } from '@/services/interactions/checker';

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    const results = await checkInteractions(userId, query);

    return NextResponse.json(results);
  } catch (error) {
    return errorResponse('POST /api/interactions/check', error, 'Interaction check failed');
  }
}
