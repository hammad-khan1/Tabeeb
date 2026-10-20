import { NextRequest } from 'next/server';
import { parseJsonBody, parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { medicationRoute, medicationUpdateSchema } from '@/services/medications/api';
import { updateMedicationRecord } from '@/services/medications/repository';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return medicationRoute(async (userId) => {
    const id = parseOrThrow(uuidParamSchema, (await params).id);
    const update = await parseJsonBody(medicationUpdateSchema, request);
    return updateMedicationRecord(userId, id, update);
  }, true);
}
