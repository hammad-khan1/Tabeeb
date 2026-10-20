import { NextRequest, NextResponse } from 'next/server';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { consume } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-error';
import { getStorage } from '@/lib/storage';
import { briefingShareLinks, documents } from '../../../../../../../../../drizzle/schema';
import { permitsOriginalDocuments } from '@/services/briefing/share';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const { token, id } = await context.params;

    // Rate limit per share token to protect server resources
    consume('read', `share_${token}`);

    // 1. Verify that share link is valid, active, and unexpired
    const [link] = await getDb()
      .select({
        userId: briefingShareLinks.userId,
        documentIds: briefingShareLinks.documentIds,
        isActive: briefingShareLinks.isActive,
        expiresAt: briefingShareLinks.expiresAt,
        includedSections: briefingShareLinks.includedSections,
        dateRangeFrom: briefingShareLinks.dateRangeFrom,
        dateRangeTo: briefingShareLinks.dateRangeTo,
      })
      .from(briefingShareLinks)
      .where(
        and(
          eq(briefingShareLinks.token, token),
          eq(briefingShareLinks.isActive, true),
          sql`${briefingShareLinks.expiresAt} > now()`
        )
      )
      .limit(1);

    if (!link) {
      return NextResponse.json(
        { error: 'This doctor briefing link is no longer available. It may have expired or been revoked.' },
        { status: 404 }
      );
    }
    if (!permitsOriginalDocuments(link.includedSections)) {
      return NextResponse.json(
        { error: 'Original documents are withheld because this briefing shares selected sections only.' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    // 2. Validate UUID format before querying PostgreSQL
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 3. Enforce document-scoping: if the patient scoped specific documents, verify document is permitted
    if (link.documentIds && link.documentIds.length > 0 && !link.documentIds.includes(id)) {
      return NextResponse.json({ error: 'Document not included in this shared briefing' }, { status: 404 });
    }

    // 3. Verify that the document belongs to the sharing patient
    const [doc] = await getDb()
      .select({
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        storagePath: documents.storagePath,
      })
      .from(documents)
      .where(and(
        eq(documents.id, id), eq(documents.userId, link.userId),
        link.dateRangeFrom ? gte(documents.documentDate, link.dateRangeFrom) : undefined,
        link.dateRangeTo ? lte(documents.documentDate, link.dateRangeTo) : undefined,
      ))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 4. Stream file from private storage
    let data: Buffer;
    try {
      data = await getStorage().read(doc.storagePath);
    } catch {
      return NextResponse.json(
        {
          error: 'The stored file for this document is missing or unavailable.',
          code: 'FILE_MISSING',
        },
        { status: 410 }
      );
    }

    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Length': String(data.length),
        'Content-Disposition': `${disposition}; filename="${doc.fileName.replace(/["\r\n]/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(
      'GET /api/briefing/share/[token]/documents/[id]/file',
      error,
      'Failed to stream shared document'
    );
  }
}
