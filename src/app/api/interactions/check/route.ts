import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { interactionCheckSchema, parseJsonBody } from '@/lib/validation';
import { checkInteractions } from '@/services/interactions/checker';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('interactions', userId);

    const { query } = await parseJsonBody(interactionCheckSchema, request);

    return NextResponse.json(await checkInteractions(userId, query));
  } catch (error) {
    return errorResponse('POST /api/interactions/check', error, 'Interaction check failed');
  }
}
