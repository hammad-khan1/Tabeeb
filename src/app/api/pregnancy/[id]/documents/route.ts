import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, parseOrThrow, parseSearchParams, pregnancyDocumentSchema, uuidParamSchema } from '@/lib/validation';
import { linkDocument, unlinkDocument } from '@/services/pregnancy/pregnancy';


/** Attaches one of her uploaded documents (a blood report, a scan) to this pregnancy. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { documentId } = await parseJsonBody(pregnancyDocumentSchema, request);
    await linkDocument(userId, id, documentId);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/pregnancy/[id]/documents', error, 'Failed to attach the document');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    consume('pregnancy', userId);
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const { documentId } = parseSearchParams(pregnancyDocumentSchema, request.nextUrl.searchParams);
    await unlinkDocument(userId, id, documentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/pregnancy/[id]/documents', error, 'Failed to detach the document');
  }
}
