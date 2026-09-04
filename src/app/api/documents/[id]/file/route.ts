import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { localStorage } from '@/lib/storage';
import { documents } from '../../../../../../drizzle/schema';

/**
 * The only way to read an uploaded file. Ownership is re-checked here on every request
 * because the bytes live outside ./public precisely so that Next cannot serve them
 * without passing through this check.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const [doc] = await getDb()
      .select({
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        storagePath: documents.storagePath,
      })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    let data: Buffer;
    try {
      data = await localStorage.read(doc.storagePath);
    } catch {
      return NextResponse.json(
        { error: 'The stored file for this document is missing.' },
        { status: 410 }
      );
    }

    const disposition = request.nextUrl.searchParams.get('download') === '1'
      ? 'attachment'
      : 'inline';

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Length': String(data.length),
        // The filename is user-supplied, so it is quoted and stripped of quotes/newlines.
        'Content-Disposition': `${disposition}; filename="${doc.fileName.replace(/["\r\n]/g, '')}"`,
        // Medical records must never sit in a shared cache.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse('GET /api/documents/[id]/file', error, 'Failed to read file');
  }
}
