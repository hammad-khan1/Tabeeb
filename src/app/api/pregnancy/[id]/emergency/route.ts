import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { createEmergencySummaryLink } from '@/services/pregnancy/pregnancy';


/** Her one-page emergency summary as a 24-hour link and QR code, made when she asks. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('share', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    return NextResponse.json(await createEmergencySummaryLink(userId, id), { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/pregnancy/[id]/emergency', error, 'Failed to create the summary link');
  }
}
