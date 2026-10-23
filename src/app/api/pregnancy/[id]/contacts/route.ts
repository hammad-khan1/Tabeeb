import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { ancContactUpdateSchema, parseJsonBody, parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { updateContact } from '@/services/pregnancy/pregnancy';


/** Marks a visit done (or not), and files the visit notes she photographed under it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { contactNumber, ...input } = await parseJsonBody(ancContactUpdateSchema, request);
    await updateContact(userId, id, contactNumber, input);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('PATCH /api/pregnancy/[id]/contacts', error, 'Failed to update the visit');
  }
}
