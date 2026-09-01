import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { localStorage } from '@/lib/storage';
import { documents } from '../../../../../drizzle/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

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

    return NextResponse.json(doc);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch document';
    console.error('[GET /api/documents/[id]]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const body = await request.json();

    const allowedFields = ['title', 'documentType', 'documentDate', 'hospital', 'doctorName'] as const;
    const updates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'documentDate' && body[field]) {
          updates[field] = new Date(body[field]);
        } else {
          updates[field] = body[field];
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date();

    const [updated] = await getDb()      .update(documents)
      .set(updates)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update document';
    console.error('[PATCH /api/documents/[id]]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

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

    // Delete file from storage
    await localStorage.delete(doc.storagePath);

    // Delete document record (cascades to chunks, medications, diagnoses, lab_results via FK)
    await getDb()      .delete(documents)
      .where(eq(documents.id, id));

    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete document';
    console.error('[DELETE /api/documents/[id]]', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
