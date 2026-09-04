import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse, notFound, badRequest } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { enqueueProcessing } from '@/services/processing-queue';
import { documents } from '../../../../../../drizzle/schema';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    consume('reprocess', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);

    const [doc] = await getDb()
      .select({ id: documents.id, status: documents.extractionStatus })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    if (!doc) throw notFound('Document not found');
    if (doc.status === 'processing') {
      throw badRequest('This document is already being processed.');
    }

    await getDb()
      .update(documents)
      .set({ extractionStatus: 'pending', extractionNotes: null, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)));

    // Queued rather than awaited: the full pipeline is vision OCR of every page plus
    // several model calls, which exceeds the request timeout on a multi-page scan.
    enqueueProcessing(id, userId);

    return NextResponse.json({ success: true, id, status: 'pending' }, { status: 202 });
  } catch (error) {
    return errorResponse('POST /api/documents/[id]/reprocess', error, 'Reprocessing failed');
  }
}
