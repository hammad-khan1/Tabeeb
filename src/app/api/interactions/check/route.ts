import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Interaction check failed';
    console.error('[POST /api/interactions/check]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
