import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { generateHealthDigest } from '@/services/insights/digest-generator';

export async function POST() {
  try {
    const userId = await getCurrentUserId();

    const insight = await generateHealthDigest(userId);

    return NextResponse.json(insight, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate insight';
    console.error('[POST /api/insights/generate]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
