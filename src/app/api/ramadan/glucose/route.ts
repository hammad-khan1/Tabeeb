import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { glucoseLogSchema, parseJsonBody } from '@/lib/validation';
import { logGlucose } from '@/services/ramadan/glucose-log';
import { getCurrentPlan } from '@/services/ramadan/plan';

/**
 * Logs a reading — typed, or transcribed by /api/voice/transcribe first — and returns
 * the alert in Urdu and English. A value Tabeeb had to interpret comes back as
 * `needs_confirmation` and is not stored until the patient confirms it, but its alert
 * is returned straight away so a low is not delayed by the question.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('glucoseLog', userId);

    const input = await parseJsonBody(glucoseLogSchema, request);
    const plan = await getCurrentPlan(userId);
    const outcome = await logGlucose(userId, plan, input);

    return NextResponse.json(outcome, { status: outcome.status === 'logged' ? 201 : 200 });
  } catch (error) {
    return errorResponse('POST /api/ramadan/glucose', error, 'Failed to log the reading');
  }
}
