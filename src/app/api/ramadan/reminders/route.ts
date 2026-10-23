import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, reminderToggleSchema } from '@/lib/validation';
import { requireCurrentPlan } from '@/services/ramadan/plan';
import { setReminderActive } from '@/services/ramadan/reminders';

/** Turns one of the day's reminders off or back on. */
export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('ramadan', userId);

    const { active, ...reminder } = await parseJsonBody(reminderToggleSchema, request);
    const plan = await requireCurrentPlan(userId);
    await setReminderActive(userId, plan.id, reminder, active);
    return NextResponse.json({ ...reminder, active });
  } catch (error) {
    return errorResponse('PATCH /api/ramadan/reminders', error, 'Failed to update the reminder');
  }
}
