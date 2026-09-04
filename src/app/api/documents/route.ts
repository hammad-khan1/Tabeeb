import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, and, gte, lte, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse, badRequest } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { getStorage } from '@/lib/storage';
import {
  createDocumentFieldsSchema,
  listDocumentsSchema,
  parseOrThrow,
  parseSearchParams,
  validateUploadFile,
} from '@/lib/validation';
import { enqueueProcessing, maybeSweepStalledDocuments } from '@/services/processing-queue';
import { documents } from '../../../../drizzle/schema';

/** OCR of a many-page scan is slow; give the platform room before it kills the request. */
export const maxDuration = 300;

/** `%` and `_` are LIKE wildcards — an unescaped user term would match far too much. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('upload', userId);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw badRequest('Expected a multipart form upload.');
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      throw badRequest('No file provided');
    }

    // Size and type were previously only checked in the browser, so a direct POST
    // bypassed both entirely.
    validateUploadFile(file);

    const fields = parseOrThrow(createDocumentFieldsSchema, {
      title: formData.get('title') || undefined,
      documentType: formData.get('documentType') || undefined,
      hospital: formData.get('hospital') || undefined,
      doctorName: formData.get('doctorName') || undefined,
      documentDate: formData.get('documentDate') || undefined,
      language: formData.get('language') || undefined,
    });

    const buffer = Buffer.from(await file.arrayBuffer());

    // Re-check after buffering: Content-Length can lie about the real body size.
    if (buffer.length === 0) {
      throw badRequest('The uploaded file is empty.');
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const storagePath = await getStorage().save(userId, `${Date.now()}_${safeName}`, buffer);

    let doc;
    try {
      [doc] = await getDb()
        .insert(documents)
        .values({
          userId,
          title: fields.title ?? file.name,
          documentType: fields.documentType,
          hospital: fields.hospital ?? null,
          doctorName: fields.doctorName ?? null,
          documentDate: fields.documentDate ?? null,
          language: fields.language,
          fileName: file.name,
          mimeType: file.type.toLowerCase().split(';')[0].trim(),
          fileSize: buffer.length,
          storagePath,
          extractionStatus: 'pending',
        })
        .returning();
    } catch (error) {
      // Don't leave an orphaned file behind if the row could not be written.
      await getStorage().delete(storagePath);
      throw error;
    }

    enqueueProcessing(doc.id, userId);

    return NextResponse.json(doc, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/documents', error, 'Upload failed');
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const query = parseSearchParams(listDocumentsSchema, request.nextUrl.searchParams);

    // The document list is polled while an upload processes, which makes it the
    // natural place to recover runs whose instance died mid-flight. Self-throttled.
    maybeSweepStalledDocuments();

    const conditions = [eq(documents.userId, userId)];

    if (query.type) conditions.push(eq(documents.documentType, query.type));
    if (query.hospital) conditions.push(eq(documents.hospital, query.hospital));
    if (query.from) conditions.push(gte(documents.documentDate, query.from));
    if (query.to) conditions.push(lte(documents.documentDate, query.to));

    if (query.search) {
      const pattern = `%${escapeLikePattern(query.search)}%`;
      const clause = or(
        ilike(documents.title, pattern),
        ilike(documents.rawExtractedText, pattern)
      );
      if (clause) conditions.push(clause);
    }

    const where = and(...conditions);

    // rawExtractedText and storagePath are deliberately not selected: the first can be
    // hundreds of kilobytes per row, the second is an internal filesystem path.
    const [rows, [{ total }]] = await Promise.all([
      getDb()
        .select({
          id: documents.id,
          title: documents.title,
          documentType: documents.documentType,
          hospital: documents.hospital,
          doctorName: documents.doctorName,
          documentDate: documents.documentDate,
          language: documents.language,
          fileName: documents.fileName,
          mimeType: documents.mimeType,
          fileSize: documents.fileSize,
          extractionStatus: documents.extractionStatus,
          extractionConfidence: documents.extractionConfidence,
          extractionNotes: documents.extractionNotes,
          summary: documents.summary,
          isHandwritten: documents.isHandwritten,
          isScannedPdf: documents.isScannedPdf,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(where)
        .orderBy(desc(documents.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      getDb()
        .select({ total: sql<number>`count(*)::int` })
        .from(documents)
        .where(where),
    ]);

    return NextResponse.json({
      documents: rows,
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + rows.length < total,
    });
  } catch (error) {
    return errorResponse('GET /api/documents', error, 'Failed to fetch documents');
  }
}
