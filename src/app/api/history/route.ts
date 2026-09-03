import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { getMedicalHistorySummary } from '@/services/history/summarizer';

export async function GET() {
  try {
    const userId = await getCurrentUserId();

    const summary = await getMedicalHistorySummary(userId);

    return NextResponse.json(summary);
  } catch (error) {
    return errorResponse('GET /api/history', error, 'Failed to fetch medical history');
  }
}
