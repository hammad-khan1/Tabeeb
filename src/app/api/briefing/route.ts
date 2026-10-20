import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-error';
import { generatePatientBriefing } from '@/services/briefing/briefing-generator';
import { parseOrThrow } from '@/lib/validation';
import { briefingFilterSchema } from '@/services/briefing/filter-schema';

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const searchParams = request.nextUrl.searchParams;
    const preset = searchParams.get('preset');
    let from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    if (preset === '30d') {
      from = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    } else if (preset === '90d') {
      from = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    } else if (preset === '180d') {
      from = new Date(Date.now() - 180 * 86400 * 1000).toISOString();
    } else if (preset === '1y') {
      from = new Date(Date.now() - 365 * 86400 * 1000).toISOString();
    }

    const docIdsRaw = searchParams.get('documentIds');
    const documentIds = docIdsRaw !== null
      ? docIdsRaw
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

    const options = parseOrThrow(briefingFilterSchema, {
      from,
      to,
      documentIds,
    });
    const briefing = await generatePatientBriefing(userId, options);

    return NextResponse.json(briefing, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  } catch (error) {
    return errorResponse('GET /api/briefing', error, 'Failed to generate patient briefing');
  }
}
