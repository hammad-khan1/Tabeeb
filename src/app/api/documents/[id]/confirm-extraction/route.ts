import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { documents } from '../../../../../../drizzle/schema';
import { applyConfirmedExtraction } from '@/services/document-processor';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const body = await request.json();

    const { correctedText, structuredData } = body as {
      correctedText?: string;
      structuredData?: Record<string, unknown>;
    };

    const [doc] = await getDb()      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {
      extractionStatus: 'confirmed',
      extractionNotes: null,
      updatedAt: new Date(),
    };

    if (correctedText !== undefined) {
      updates.rawExtractedText = correctedText;
    }

    if (structuredData !== undefined) {
      updates.structuredData = structuredData;
    }

    const [updated] = await getDb()
      .update(documents)
      .set(updates)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning();

    await applyConfirmedExtraction(id, userId);

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse('POST /api/documents/[id]/confirm-extraction', error, 'Failed to confirm extraction');
  }
}
