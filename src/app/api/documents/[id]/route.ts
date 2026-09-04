import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse, notFound } from '@/lib/api-error';
import { getStorage } from '@/lib/storage';
import { parseJsonBody, parseOrThrow, updateDocumentSchema, uuidParamSchema } from '@/lib/validation';
import { documents, imagingFindings } from '../../../../../drizzle/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const id = parseOrThrow(uuidParamSchema, (await params).id);

    const [doc] = await getDb()
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    if (!doc) throw notFound('Document not found');

    const findings =
      doc.documentType === 'imaging_report'
        ? await getDb()
            .select()
            .from(imagingFindings)
            .where(eq(imagingFindings.documentId, id))
            .orderBy(imagingFindings.createdAt)
        : [];

    // storagePath is an internal filesystem path; the file is fetched from
    // /api/documents/[id]/file, which re-checks ownership.
    const { storagePath: _storagePath, ...safe } = doc;

    return NextResponse.json({
      ...safe,
      fileUrl: `/api/documents/${id}/file`,
      imagingFindings: findings,
    });
  } catch (error) {
    return errorResponse('GET /api/documents/[id]', error, 'Failed to fetch document');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const updates = await parseJsonBody(updateDocumentSchema, request);

    const [updated] = await getDb()
      .update(documents)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning();

    if (!updated) throw notFound('Document not found');

    const { storagePath: _storagePath, ...safe } = updated;
    return NextResponse.json(safe);
  } catch (error) {
    return errorResponse('PATCH /api/documents/[id]', error, 'Failed to update document');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const id = parseOrThrow(uuidParamSchema, (await params).id);

    // Delete the row first: a leftover file is recoverable, a record pointing at a
    // file that is already gone is not.
    const [deleted] = await getDb()
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning({ storagePath: documents.storagePath });

    if (!deleted) throw notFound('Document not found');

    await getStorage().delete(deleted.storagePath);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse('DELETE /api/documents/[id]', error, 'Failed to delete document');
  }
}
