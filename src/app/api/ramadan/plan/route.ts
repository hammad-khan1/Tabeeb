import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, ramadanPlanSchema, ramadanPlanUpdateSchema } from '@/lib/validation';
import { hasDiabetes } from '@/services/ramadan/auto-fill';
import {
  estimatedRamadan,
  getCurrentPlan,
  requireCurrentPlan,
  savePlan,
  setDoctorPlanDocument,
} from '@/services/ramadan/plan';
import { PAKISTAN_CITIES } from '@/services/ramadan/prayer-times';

/** The current plan, or what the opt-in card needs to start one. */
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const [plan, diabetic] = await Promise.all([getCurrentPlan(userId), hasDiabetes(userId)]);
    return NextResponse.json({
      plan,
      hasDiabetes: diabetic,
      estimatedDates: estimatedRamadan(),
      cities: PAKISTAN_CITIES,
    });
  } catch (error) {
    return errorResponse('GET /api/ramadan/plan', error, 'Failed to load Ramzan plan');
  }
}

/** Creates this year's plan, or updates it: one plan per user per year. */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('ramadan', userId);

    const input = await parseJsonBody(ramadanPlanSchema, request);
    const plan = await savePlan(userId, input);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/ramadan/plan', error, 'Failed to save Ramzan plan');
  }
}

/** Links the uploaded prescription that holds the doctor's Ramzan doses. */
export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('ramadan', userId);

    const { doctorPlanDocumentId } = await parseJsonBody(ramadanPlanUpdateSchema, request);
    const current = await requireCurrentPlan(userId);
    const plan = await setDoctorPlanDocument(userId, current.id, doctorPlanDocumentId);
    return NextResponse.json({ plan });
  } catch (error) {
    return errorResponse('PATCH /api/ramadan/plan', error, 'Failed to update Ramzan plan');
  }
}
