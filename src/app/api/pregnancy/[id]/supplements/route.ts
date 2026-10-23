import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, parseOrThrow, parseSearchParams, supplementLogSchema, uuidParamSchema } from '@/lib/validation';
import { logSupplement, removeSupplement } from '@/services/pregnancy/pregnancy';


/** "Goli li?" — the day's iron tablet, or a tetanus injection. A second tap changes nothing. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { kind, day } = await parseJsonBody(supplementLogSchema, request);
    await logSupplement(userId, id, kind, day);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/pregnancy/[id]/supplements', error, 'Failed to record it');
  }
}

/** Undo a tap made by mistake. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { kind, day } = parseSearchParams(supplementLogSchema, request.nextUrl.searchParams);
    await removeSupplement(userId, id, kind, day);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/pregnancy/[id]/supplements', error, 'Failed to undo it');
  }
}
