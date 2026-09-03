import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { documents } from '../../../../../../drizzle/schema';
import { processDocument } from '@/services/document-processor';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const [doc] = await getDb()
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await getDb()
      .update(documents)
      .set({ extractionStatus: 'pending', updatedAt: new Date() })
      .where(eq(documents.id, id));

    await processDocument(id, userId);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse('POST /api/documents/[id]/reprocess', error, 'Reprocessing failed');
  }
}
