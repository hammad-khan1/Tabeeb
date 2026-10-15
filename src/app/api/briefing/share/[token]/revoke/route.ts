import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-error';
import { revokeBriefingShareLink } from '@/services/briefing/share';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    consume('share', userId);

    const { token } = await context.params;
    await revokeBriefingShareLink(userId, token);

    return NextResponse.json({ success: true, message: 'Share link revoked successfully' });
  } catch (error) {
    return errorResponse('POST /api/briefing/share/[token]/revoke', error, 'Failed to revoke briefing link');
  }
}
