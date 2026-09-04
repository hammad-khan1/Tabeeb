import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
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
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { correctedText, structuredData } = await parseJsonBody(
      confirmExtractionSchema,
      request
    );

    const [updated] = await getDb()
      .update(documents)
      .set({
        extractionStatus: 'confirmed',
        extractionNotes: null,
        ...(correctedText !== undefined && { rawExtractedText: correctedText }),
        ...(structuredData !== undefined && { structuredData }),
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning();

    if (!updated) throw notFound('Document not found');

    // Rebuilds entities and re-embeds chunks from the corrected text, so what RAG
    // searches is what the patient actually confirmed.
    await applyConfirmedExtraction(id, userId);

    const { storagePath: _storagePath, ...safe } = updated;
    return NextResponse.json(safe);
  } catch (error) {
    return errorResponse(
      'POST /api/documents/[id]/confirm-extraction',
      error,
      'Failed to confirm extraction'
    );
  }
}
