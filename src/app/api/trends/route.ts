import { NextRequest, NextResponse } from 'next/server';
import { eq, and, asc, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse, notFound } from '@/lib/api-error';
import { parseSearchParams, trendsSchema } from '@/lib/validation';
import { analyzeLabTrend } from '@/services/trends/analyzer';
import { findAnalyte } from '@/services/nlp/lab-normalizer';
import { labResults } from '../../../../drizzle/schema';

/** Distinct analytes the user has results for — what a trend picker needs. */
export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const params = request.nextUrl.searchParams;

    if (!params.has('test_name')) {
      const rows = await getDb()
        .select({
          canonicalTestName: labResults.canonicalTestName,
          testName: labResults.testName,
          unit: labResults.canonicalUnit,
          count: sql<number>`count(*)::int`,
          latest: sql<string>`max(${labResults.testDate})`,
        })
        .from(labResults)
        .where(eq(labResults.userId, userId))
        .groupBy(labResults.canonicalTestName, labResults.testName, labResults.canonicalUnit)
        .orderBy(sql`count(*) desc`);

      // Collapse rows that share a canonical analyte but differ in verbatim spelling.
      const merged = new Map<string, { key: string; display: string; unit: string | null; count: number }>();
      for (const row of rows) {
        const key = row.canonicalTestName ?? row.testName.toLowerCase().trim();
        const existing = merged.get(key);
        if (existing) {
          existing.count += row.count;
        } else {
          merged.set(key, {
            key,
            display: findAnalyte(row.testName)?.display ?? row.testName,
            unit: row.unit,
            count: row.count,
          });
        }
      }

      return NextResponse.json({ tests: [...merged.values()] });
    }

    const { test_name: testName } = parseSearchParams(trendsSchema, params);

    // Match on the canonical key when the requested name resolves to a known analyte,
    // so "HbA1c", "HBA1C" and "Glycated Haemoglobin" return one series. Exact-name
    // matching previously meant a trend rarely spanned two documents.
    const analyte = findAnalyte(testName);
    const match = analyte
      ? or(
          eq(labResults.canonicalTestName, analyte.key),
          eq(labResults.testName, testName)
        )
      : eq(labResults.testName, testName);

    const results = await getDb()
      .select()
      .from(labResults)
      .where(and(eq(labResults.userId, userId), match))
      .orderBy(asc(labResults.testDate));

    if (results.length === 0) {
      throw notFound('No lab results found for this test');
    }

    // Prefer the unit-converted value so mg/dL and µmol/L readings share an axis.
    const dataPoints = results
      .map((r) => ({
        raw: r,
        value: r.canonicalValue ?? r.numericValue,
      }))
      .filter((p): p is { raw: typeof p.raw; value: number } => p.value !== null)
      .map((p) => ({
        value: p.value,
        date: p.raw.testDate,
        referenceRange: p.raw.referenceRange ?? undefined,
        documentId: p.raw.documentId,
      }));

    const displayName = analyte?.display ?? results[0].testName;
    const unit = analyte?.canonicalUnit ?? results[0].unit ?? null;

    if (dataPoints.length === 0) {
      return NextResponse.json({
        testName: displayName,
        unit,
        dataPoints: [],
        analysis: null,
        message: 'No numeric values available for trend analysis',
        rawResults: results,
      });
    }

    return NextResponse.json({
      testName: displayName,
      unit,
      dataPoints,
      analysis: analyzeLabTrend(dataPoints),
      rawResults: results,
    });
  } catch (error) {
    return errorResponse('GET /api/trends', error, 'Trend analysis failed');
  }
}
