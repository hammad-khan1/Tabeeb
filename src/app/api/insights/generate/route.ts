import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { generateHealthDigest } from '@/services/insights/digest-generator';

export async function POST() {
  try {
    const userId = await getCurrentUserId();

    const insight = await generateHealthDigest(userId);

    return NextResponse.json(insight, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/insights/generate', error, 'Failed to generate insight');
  }
}
