import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, pregnancyDocumentSchema } from '@/lib/validation';
import { readDueDateFromDocument } from '@/services/pregnancy/pregnancy';

/** Due dates found in an uploaded ultrasound report, for the family to confirm. */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const { documentId } = await parseJsonBody(pregnancyDocumentSchema, request);
    return NextResponse.json(await readDueDateFromDocument(userId, documentId));
  } catch (error) {
    return errorResponse('POST /api/pregnancy/due-date', error, 'Failed to read the report');
  }
}
