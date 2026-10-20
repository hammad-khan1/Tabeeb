import { NextRequest } from 'next/server';
import { parseOrThrow, uuidParamSchema } from '@/lib/validation';
import { medicationRoute } from '@/services/medications/api';
import { getMedicationDetails } from '@/services/medications/workspace';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return medicationRoute(async (userId) =>
    getMedicationDetails(userId, parseOrThrow(uuidParamSchema, (await params).id))
  );
}
