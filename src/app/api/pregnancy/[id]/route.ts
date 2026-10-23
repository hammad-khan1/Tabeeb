import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, parseOrThrow, updatePregnancySchema, uuidParamSchema } from '@/lib/validation';
import { deletePregnancy, getPregnancyView, updatePregnancy } from '@/services/pregnancy/pregnancy';


/** Everything the Mother-care screen shows: week, visits, tablets, readings, family. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    return NextResponse.json(await getPregnancyView(userId, id));
  } catch (error) {
    return errorResponse('GET /api/pregnancy/[id]', error, 'Failed to load the pregnancy record');
  }
}

/** Blood group, tetanus history, birth plan, the birth itself, or ending the record. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const input = await parseJsonBody(updatePregnancySchema, request);
    return NextResponse.json({ pregnancy: await updatePregnancy(userId, id, input) });
  } catch (error) {
    return errorResponse('PATCH /api/pregnancy/[id]', error, 'Failed to update the pregnancy record');
  }
}

/** Her record is hers to remove. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    await deletePregnancy(userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/pregnancy/[id]', error, 'Failed to delete the pregnancy record');
  }
}
