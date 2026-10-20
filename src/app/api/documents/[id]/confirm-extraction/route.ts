import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse, notFound } from '@/lib/api-error';
import {
  confirmExtractionSchema,
  parseJsonBody,
  parseOrThrow,
  uuidParamSchema,
} from '@/lib/validation';
import { documents } from '../../../../../../drizzle/schema';
import { applyConfirmedExtraction } from '@/services/document-processor';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    consume('confirmExtraction', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { correctedText, structuredData } = await parseJsonBody(
      confirmExtractionSchema,
      request
    );

    // Confirmation, patient corrections, and derived data commit together. An
    // upstream embedding failure must not mark incomplete processing confirmed.
    await applyConfirmedExtraction(id, userId, { correctedText, structuredData });
    const [updated] = await getDb()
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    if (!updated) throw notFound('Document not found');

    const { storagePath: _storagePath, ...safe } = updated;
    return NextResponse.json(safe, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(
      'POST /api/documents/[id]/confirm-extraction',
      error,
      'Failed to confirm extraction'
    );
  }
}
