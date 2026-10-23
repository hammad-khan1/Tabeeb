import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { bpReadingSchema, parseJsonBody, parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { addBpReading } from '@/services/pregnancy/pregnancy';


/** A blood pressure reading, kept for the emergency summary and the doctor. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { systolic, diastolic } = await parseJsonBody(bpReadingSchema, request);
    return NextResponse.json({ reading: await addBpReading(userId, id, systolic, diastolic) }, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/pregnancy/[id]/bp', error, 'Failed to save the reading');
  }
}
