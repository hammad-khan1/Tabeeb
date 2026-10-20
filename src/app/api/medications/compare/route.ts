import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseOrThrow } from '@/lib/validation';
import { medicationRoute } from '@/services/medications/api';
import { compareMedicationDocuments } from '@/services/medications/workspace';

const querySchema = z.object({ left: z.uuid(), right: z.uuid() })
  .refine((value) => value.left !== value.right, 'Choose two different documents.');

export async function GET(request: NextRequest) {
  return medicationRoute(async (userId) => {
    const { left, right } = parseOrThrow(querySchema, Object.fromEntries(request.nextUrl.searchParams));
    return compareMedicationDocuments(userId, left, right);
  });
}
