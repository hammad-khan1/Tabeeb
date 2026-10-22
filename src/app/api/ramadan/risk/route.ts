import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, ramadanRiskSchema } from '@/lib/validation';
import { RISK_ITEMS, type RiskItemId } from '@/services/ramadan/constants';
import { computeRisk, requireCurrentPlan, saveRisk } from '@/services/ramadan/plan';

/** The risk items, what the record filled, and what is left to ask. */
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const plan = await requireCurrentPlan(userId);
    const state = await computeRisk(userId, plan);
    return NextResponse.json({ riskItems: RISK_ITEMS, ...state });
  } catch (error) {
    return errorResponse('GET /api/ramadan/risk', error, 'Failed to load the risk score');
  }
}

/** Answers and overrides in; the recomputed, saved score out. */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('ramadan', userId);

    const { answers } = await parseJsonBody(ramadanRiskSchema, request);
    const plan = await requireCurrentPlan(userId);
    const state = await computeRisk(
      userId,
      plan,
      answers.map((answer) => ({ item: answer.item as RiskItemId, option: answer.option }))
    );
    await saveRisk(userId, plan.id, state);

    return NextResponse.json({ riskItems: RISK_ITEMS, ...state });
  } catch (error) {
    return errorResponse('POST /api/ramadan/risk', error, 'Failed to save the risk score');
  }
}
