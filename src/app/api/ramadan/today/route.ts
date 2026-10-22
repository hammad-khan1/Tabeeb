import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { requireCurrentPlan } from '@/services/ramadan/plan';
import { buildToday } from '@/services/ramadan/today';

/** Today's Sehri and Iftar, reminders and latest readings. */
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const plan = await requireCurrentPlan(userId);
    return NextResponse.json(await buildToday(userId, plan));
  } catch (error) {
    return errorResponse('GET /api/ramadan/today', error, "Failed to load today's schedule");
  }
}
