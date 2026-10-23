import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { z } from 'zod';
import {
  caregiverSchema,
  caregiverUpdateSchema,
  parseJsonBody,
  parseOrThrow,
  parseSearchParams,
  uuidParamSchema,
} from '@/lib/validation';
import { addCaregiver, removeCaregiver, updateCaregiver } from '@/services/pregnancy/pregnancy';

const removeSchema = z.object({ caregiverId: z.uuid() });


/** Adds a family member she chose to keep informed. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const input = await parseJsonBody(caregiverSchema, request);
    return NextResponse.json({ caregiver: await addCaregiver(userId, id, input) }, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/pregnancy/[id]/caregivers', error, 'Failed to add the family member');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { caregiverId, ...input } = await parseJsonBody(caregiverUpdateSchema, request);
    return NextResponse.json({ caregiver: await updateCaregiver(userId, id, caregiverId, input) });
  } catch (error) {
    return errorResponse('PATCH /api/pregnancy/[id]/caregivers', error, 'Failed to update the family member');
  }
}

/** She can remove anyone, at any time. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { caregiverId } = parseSearchParams(removeSchema, request.nextUrl.searchParams);
    await removeCaregiver(userId, id, caregiverId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/pregnancy/[id]/caregivers', error, 'Failed to remove the family member');
  }
}
