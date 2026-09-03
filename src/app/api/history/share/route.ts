import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { createShareLink, getSharedHistory } from '@/services/history/share';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }
    const result = await getSharedHistory(token);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load shared history';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await request.json();

    const { title, documentIds, expiresInHours } = body as {
      title?: string;
      documentIds?: string[];
      expiresInHours?: number;
    };

    const result = await createShareLink(userId, {
      title,
      documentIds,
      expiresInHours,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/history/share', error, 'Failed to create share link');
  }
}
