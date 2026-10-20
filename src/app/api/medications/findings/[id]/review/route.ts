import { NextRequest } from 'next/server';
import { parseJsonBody, parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { findingReviewSchema, medicationRoute } from '@/services/medications/api';
import { reviewMedicationFinding } from '@/services/medications/repository';
import { getMedicationWorkspace } from '@/services/medications/workspace';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return medicationRoute(async (userId) => {
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const update = await parseJsonBody(findingReviewSchema, request);
    await getMedicationWorkspace(userId);
    return reviewMedicationFinding(userId, id, update);
  }, true);
}
