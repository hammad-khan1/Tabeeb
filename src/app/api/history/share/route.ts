import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { createShareSchema, revokeShareSchema, parseJsonBody, parseSearchParams } from '@/lib/validation';
import { createShareLink, listShareLinks, revokeShareLink } from '@/services/history/share';

/** The patient's own links, so they can see what is outstanding and revoke it. */
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    return NextResponse.json(await listShareLinks(userId));
  } catch (error) {
    return errorResponse('GET /api/history/share', error, 'Failed to list share links');
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('share', userId);

    const options = await parseJsonBody(createShareSchema, request);
    const result = await createShareLink(userId, options);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/history/share', error, 'Failed to create share link');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { token } = parseSearchParams(revokeShareSchema, request.nextUrl.searchParams);

    await revokeShareLink(userId, token);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/history/share', error, 'Failed to revoke share link');
  }
}
