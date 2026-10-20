import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse, ApiError } from '@/lib/api-error';
import {
  createBriefingShareLink,
  listBriefingShareLinks,
} from '@/services/briefing/share';

const createBriefingShareSchema = z.object({
  title: z.string().trim().max(500).optional(),
  documentIds: z.array(z.string().uuid()).optional(),
  includedSections: z.array(z.string()).optional(),
  dateRangeFrom: z.string().optional().nullable(),
  dateRangeTo: z.string().optional().nullable(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
});

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const links = await listBriefingShareLinks(userId);
    return NextResponse.json(links);
  } catch (error) {
    return errorResponse('GET /api/briefing/share', error, 'Failed to list briefing share links');
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('share', userId);

    const body = await request.json();
    const parsed = createBriefingShareSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid share configuration');
    }

    const result = await createBriefingShareLink(userId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/briefing/share', error, 'Failed to create briefing share link');
  }
}
