import { NextRequest, NextResponse } from 'next/server';
import { eq, and, asc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { analyzeLabTrend } from '@/services/trends/analyzer';
import { labResults } from '../../../../drizzle/schema';

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const testName = request.nextUrl.searchParams.get('test_name');

    if (!testName) {
      return NextResponse.json(
        { error: 'test_name query parameter is required' },
        { status: 400 }
      );
    }

    const results = await getDb()      .select()
      .from(labResults)
      .where(
        and(
          eq(labResults.userId, userId),
          eq(labResults.testName, testName)
        )
      )
      .orderBy(asc(labResults.testDate));

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No lab results found for this test' },
        { status: 404 }
      );
    }

    // Build data points from results that have numeric values
    const dataPoints = results
      .filter((r) => r.numericValue !== null)
      .map((r) => ({
        value: r.numericValue!,
        date: r.testDate,
        referenceRange: r.referenceRange ?? undefined,
      }));

    if (dataPoints.length === 0) {
      return NextResponse.json({
        dataPoints: [],
        analysis: null,
        message: 'No numeric values available for trend analysis',
        rawResults: results,
      });
    }

    const analysis = analyzeLabTrend(dataPoints);

    return NextResponse.json({
      dataPoints,
      analysis,
      rawResults: results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Trend analysis failed';
    console.error('[GET /api/trends]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
