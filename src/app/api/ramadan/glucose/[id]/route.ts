import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { glucoseLogUpdateSchema, parseJsonBody, parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { markFastBroken } from '@/services/ramadan/glucose-log';

/** "Done, I broke my fast" on an alert. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    consume('ramadan', userId);

    const id = parseOrThrow(uuidParamSchema, (await params).id);
    await parseJsonBody(glucoseLogUpdateSchema, request);

    const fastBrokenAt = await markFastBroken(userId, id);
    return NextResponse.json({ id, fastBrokenAt });
  } catch (error) {
    return errorResponse('PATCH /api/ramadan/glucose/[id]', error, 'Failed to update the reading');
  }
}
