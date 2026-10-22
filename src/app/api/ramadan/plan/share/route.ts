import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, parseSearchParams, planShareSchema, revokeShareSchema } from '@/lib/validation';
import { revokeShareLink } from '@/services/history/share';
import { requireCurrentPlan } from '@/services/ramadan/plan';
import { createPlanSheetLink, listPlanSheetLinks } from '@/services/ramadan/plan-sheet';

/** The doctor-sheet links for the current plan, so the patient can revoke them. */
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const plan = await requireCurrentPlan(userId);
    return NextResponse.json(await listPlanSheetLinks(userId, plan.id));
  } catch (error) {
    return errorResponse('GET /api/ramadan/plan/share', error, 'Failed to list plan links');
  }
}

/** An expiring link to the one-page plan sheet for the patient's doctor. */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('share', userId);

    const { expiresInHours } = await parseJsonBody(planShareSchema, request);
    const plan = await requireCurrentPlan(userId);
    const link = await createPlanSheetLink(userId, plan.id, expiresInHours);
    return NextResponse.json(link, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/ramadan/plan/share', error, 'Failed to create the plan link');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('share', userId);

    const { token } = parseSearchParams(revokeShareSchema, request.nextUrl.searchParams);
    await revokeShareLink(userId, token);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/ramadan/plan/share', error, 'Failed to revoke the plan link');
  }
}
