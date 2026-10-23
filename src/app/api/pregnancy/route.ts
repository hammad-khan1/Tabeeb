import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { createPregnancySchema, parseJsonBody } from '@/lib/validation';
import { createPregnancy, listPregnancies } from '@/services/pregnancy/pregnancy';

/** The pregnancy records on this account, newest first. */
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);
    return NextResponse.json(await listPregnancies(userId));
  } catch (error) {
    return errorResponse('GET /api/pregnancy', error, 'Failed to load pregnancy records');
  }
}

/** Starts a record from the last period date or the due date, with its eight visits. */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);

    const input = await parseJsonBody(createPregnancySchema, request);
    const pregnancy = await createPregnancy(userId, input);
    return NextResponse.json({ pregnancy }, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/pregnancy', error, 'Failed to start the pregnancy record');
  }
}
