import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, and, gte, lte, like, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { localStorage } from '@/lib/storage';
import { processDocument } from '@/services/document-processor';
import { documents } from '../../../../drizzle/schema';

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    const title = (formData.get('title') as string) || file.name;
    const documentType = (formData.get('documentType') as string) || 'other';
    const hospital = formData.get('hospital') as string | null;
    const doctorName = formData.get('doctorName') as string | null;
    const documentDate = formData.get('documentDate') as string | null;
    const language = (formData.get('language') as string) || 'mixed';

    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageFileName = `${timestamp}_${safeName}`;
    const storagePath = await localStorage.save(userId, storageFileName, buffer);

    const [doc] = await getDb()      .insert(documents)
      .values({
        userId,
        title,
        documentType: documentType as typeof documents.documentType.enumValues[number],
        hospital,
        doctorName,
        documentDate: documentDate ? new Date(documentDate) : null,
        language: language as typeof documents.language.enumValues[number],
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: buffer.length,
        storagePath,
        extractionStatus: 'pending',
      })
      .returning();

    // Fire and forget — async processing in background
    processDocument(doc.id, userId).catch((err) => {
      console.error(`[DocumentProcessor] Failed for ${doc.id}:`, err);
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/documents', error, 'Upload failed');
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const searchParams = request.nextUrl.searchParams;

    const type = searchParams.get('type');
    const hospital = searchParams.get('hospital');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const search = searchParams.get('search');

    const conditions = [eq(documents.userId, userId)];

    if (type) {
      conditions.push(eq(documents.documentType, type as typeof documents.documentType.enumValues[number]));
    }

    if (hospital) {
      conditions.push(eq(documents.hospital, hospital));
    }

    if (from) {
      conditions.push(gte(documents.documentDate, new Date(from)));
    }

    if (to) {
      conditions.push(lte(documents.documentDate, new Date(to)));
    }

    if (search) {
      conditions.push(
        sql`(${like(documents.title, `%${search}%`)} OR ${like(documents.rawExtractedText, `%${search}%`)})`
      );
    }

    const results = await getDb()      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json(results);
  } catch (error) {
    return errorResponse('GET /api/documents', error, 'Failed to fetch documents');
  }
}
