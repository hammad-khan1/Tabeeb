import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { generateHealthDigest } from '@/services/insights/digest-generator';

export const maxDuration = 300;

export async function POST() {
  try {
    const userId = await getCurrentUserId();
    // Reads the whole record and generates a long digest, so this is the tightest limit.
    consume('insights', userId);

    return NextResponse.json(await generateHealthDigest(userId), { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/insights/generate', error, 'Failed to generate insight');
  }
}
