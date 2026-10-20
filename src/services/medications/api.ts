import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, getCurrentUserId } from '@/lib/auth';
import { ApiError } from '@/lib/api-error';
import { consume, RateLimitError } from '@/lib/rate-limit';
import { MEDICATION_STATUSES } from './types';

export const medicationListQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.union([z.enum(MEDICATION_STATUSES), z.literal('all')]).default('all'),
  search: z.string().trim().max(200).default(''),
});
export const findingReviewStatuses = ['open', 'needs_verification', 'reviewed', 'resolved', 'dismissed'] as const;
export const findingQuery = medicationListQuery.omit({ status: true }).extend({
  status: z.enum(['all', ...findingReviewStatuses]).default('all'),
  category: z.enum(['all', 'allergy_concern', 'drug_interaction', 'exact_duplicate', 'ingredient_duplication',
    'therapeutic_duplication', 'conflicting_instructions', 'missing_information', 'uncertain_identity',
    'reconciliation_difference']).default('all'),
  history: z.enum(['0', '1']).default('0'),
});
export const timelineQuery = medicationListQuery.omit({ status: true }).extend({
  medicationId: z.union([z.uuid(), z.literal('all'), z.literal('')]).optional(),
  view: z.enum(['all', 'current', 'historical']).default('all'),
});
const correctionText = z.string().trim().max(2000).nullable().optional();
export const medicationUpdateSchema = z.object({
  status: z.enum(MEDICATION_STATUSES).optional(),
  corrections: z.object({
    name: z.string().trim().min(1).max(500).nullable().optional(),
    dosage: correctionText, frequency: correctionText, duration: correctionText,
    route: correctionText, strength: correctionText, doseAmount: correctionText, instructions: correctionText,
  }).strict().refine((value) => Object.keys(value).length > 0, 'Include a correction.').optional(),
  note: z.string().trim().min(1).max(2000),
}).strict().refine((value) => value.status !== undefined || value.corrections !== undefined, 'Include a status or correction.');
export const findingReviewSchema = z.object({
  status: z.enum(findingReviewStatuses),
  note: z.string().trim().max(2000).optional(),
}).strict().refine((value) => !['dismissed', 'resolved'].includes(value.status) || Boolean(value.note),
  'A reason is required to dismiss or resolve a finding.');

export function medicationJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: {
    'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff',
  } });
}

/** Expected errors are safe; never log raw SQL/excerpts from medical write failures. */
export async function medicationRoute(action: (userId: string) => Promise<unknown>, write = false) {
  try {
    const userId = await getCurrentUserId();
    consume(write ? 'settings' : 'read', userId);
    return medicationJson(await action(userId));
  } catch (error) {
    if (error instanceof AuthError) return medicationJson({ error: error.message }, 401);
    if (error instanceof ApiError) return medicationJson({ error: error.message }, error.statusCode);
    if (error instanceof RateLimitError) {
      const response = medicationJson({ error: error.message }, 429);
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
      return response;
    }
    return medicationJson({ error: 'Medication records are temporarily unavailable. Please try again.' }, 500);
  }
}
