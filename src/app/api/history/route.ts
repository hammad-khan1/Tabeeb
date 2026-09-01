import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getMedicalHistorySummary } from '@/services/history/summarizer';

export async function GET() {
  try {
    const userId = await getCurrentUserId();

    const summary = await getMedicalHistorySummary(userId);

    return NextResponse.json(summary);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch medical history';
    console.error('[GET /api/history]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
