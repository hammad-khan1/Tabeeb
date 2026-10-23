import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { dangerSignSchema, parseJsonBody, parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { reportDangerSign } from '@/services/pregnancy/pregnancy';


/**
 * "Mujhe yeh ho raha hai." Records the sign, alerts the family members she chose, and
 * returns her emergency summary as a QR code. The screen has already told her to go to
 * the hospital before this returns.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancyDanger', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { sign } = await parseJsonBody(dangerSignSchema, request);
    return NextResponse.json(await reportDangerSign(userId, id, sign), { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/pregnancy/[id]/danger', error, 'Failed to send the alert');
  }
}
