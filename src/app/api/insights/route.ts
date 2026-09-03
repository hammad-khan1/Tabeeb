import { NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { healthInsights } from '../../../../drizzle/schema';

export async function GET() {
  try {
    const userId = await getCurrentUserId();

    const insights = await getDb()      .select()
      .from(healthInsights)
      .where(eq(healthInsights.userId, userId))
      .orderBy(desc(healthInsights.generatedAt));

    return NextResponse.json(insights);
  } catch (error) {
    return errorResponse('GET /api/insights', error, 'Failed to fetch insights');
  }
}
