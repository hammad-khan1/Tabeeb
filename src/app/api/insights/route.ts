import { NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { healthInsights } from '../../../../drizzle/schema';

export async function GET() {
  try {
    const userId = await getCurrentUserId();

    const insights = await getDb()      .select()
      .from(healthInsights)
      .where(eq(healthInsights.userId, userId))
      .orderBy(desc(healthInsights.generatedAt));

    return NextResponse.json(insights);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch insights';
    console.error('[GET /api/insights]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
