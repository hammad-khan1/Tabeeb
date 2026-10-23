import { z } from 'zod';
import { badRequest } from './api-error';
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE } from './constants';
import { RISK_ITEMS } from '@/services/ramadan/constants';
import { SYMPTOMS } from '@/services/ramadan/glucose-rules';

/**
 * Every request boundary parses through here. Zod was already a dependency but was
 * only used on extraction output, which left query params, form fields and JSON
 * bodies going straight into enum columns and `jsonb`.
 */

export const DOCUMENT_TYPES = [
  'prescription',
  'lab_report',
  'discharge_summary',
  'imaging_report',
  'consultation_note',
  'voice_entry',
  'other',
] as const;

export const LANGUAGES = ['en', 'ur', 'mixed'] as const;

/** Rejects `new Date('nonsense')`, which otherwise reaches Postgres as Invalid Date. */
const isoDate = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'must be a valid date')
  .transform((value) => new Date(value));

export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export const languageSchema = z.enum(LANGUAGES);

export const createDocumentFieldsSchema = z.object({
  title: z.string().trim().min(1).max(500).nullish().transform((v) => v ?? undefined),
  documentType: documentTypeSchema.default('other'),
  hospital: z.string().trim().max(500).optional(),
  doctorName: z.string().trim().max(255).optional(),
  documentDate: isoDate.optional(),
  language: languageSchema.default('mixed'),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    documentType: documentTypeSchema.optional(),
    documentDate: isoDate.nullable().optional(),
    hospital: z.string().trim().max(500).nullable().optional(),
    doctorName: z.string().trim().max(255).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'No valid fields to update');

export const listDocumentsSchema = z.object({
  type: documentTypeSchema.optional(),
  hospital: z.string().trim().max(500).optional(),
  /**
   * Filters to documents carrying a diagnosis of this condition. Matched on the
   * canonical concept where one was linked, so "DM type II", "T2DM" and "شوگر" all
   * select the same records — which is the point of the filter.
   */
  condition: z.string().trim().min(1).max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(1000),
  section: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(6),
});

export const chatSchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(4000),
  // `.nullish()`, not `.optional()`: the client holds conversationId in state that
  // starts as null, so the first message of every conversation sends an explicit
  // null. `.optional()` accepts undefined but rejects null, which 400'd every new
  // chat.
  conversationId: z.uuid().nullish().transform((v) => v ?? undefined),
});

export const chatHistorySchema = z.object({
  conversationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const interactionCheckSchema = z.object({
  query: z.string().trim().min(1, 'Query is required').max(2000),
});

export const trendsSchema = z.object({
  test_name: z.string().trim().min(1).max(500),
});

/** These land in `jsonb` and in the chat system prompt, so both size and shape matter. */
const profileList = z.array(z.string().trim().min(1).max(200)).max(100);

export const settingsSchema = z
  .object({
    preferredLanguage: languageSchema.optional(),
    knownAllergies: profileList.optional(),
    knownConditions: profileList.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'No settings provided');

/** `nullish` throughout: form state commonly holds null for "not filled in". */
export const createShareSchema = z.object({
  title: z.string().trim().max(500).nullish().transform((v) => v ?? undefined),
  documentIds: z.array(z.uuid()).max(200).default([]),
  // Capped at 30 days — an indefinite link to a medical record is a liability.
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(168),
});

/**
 * Deleting an account destroys the record and every uploaded file, irreversibly. The
 * UI asks the user to type DELETE; the API asked for nothing, so anything holding a
 * session could wipe the account in one request. The confirmation is now part of the
 * contract rather than a courtesy the front end happens to provide.
 */
export const deleteAccountSchema = z.object({
  confirm: z.literal('DELETE', {
    message: 'Send { "confirm": "DELETE" } to permanently delete your account.',
  }),
});

export const revokeShareSchema = z.object({
  token: z.string().trim().min(1).max(255),
});

export const confirmExtractionSchema = z.object({
  correctedText: z.string().max(500_000).optional(),
  structuredData: z.record(z.string(), z.unknown()).optional(),
});

// ── Ramzan Mode ─────────────────────────────────────────────────────────────

/** A civil date, kept as a string: Ramzan dates are days, not instants. */
const calendarDay = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'must be a real date');

const DAY_MS = 24 * 60 * 60 * 1000;

export const ramadanPlanSchema = z
  .object({
    ramadanStart: calendarDay,
    ramadanEnd: calendarDay,
    intendsToFast: z.boolean(),
    city: z.string().trim().min(1).max(50).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    caregiverName: z.string().trim().max(255).nullish(),
    caregiverPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 -]{6,19}$/, 'must be a phone number')
      .nullish(),
  })
  .refine((value) => {
    // Ramzan is 29 or 30 days; a little slack for a date entered a day off.
    const days = (Date.parse(value.ramadanEnd) - Date.parse(value.ramadanStart)) / DAY_MS;
    return days >= 27 && days <= 30;
  }, 'ramadanEnd must be 28 to 31 days after ramadanStart, inclusive')
  .refine(
    (value) => value.city !== undefined || (value.latitude !== undefined && value.longitude !== undefined),
    'Choose a city or share your location'
  );

export const ramadanPlanUpdateSchema = z.object({
  /** The uploaded prescription that holds the doctor's Ramzan doses; null unlinks it. */
  doctorPlanDocumentId: z.uuid().nullable(),
});

const RISK_ITEM_IDS = RISK_ITEMS.map((item) => item.id) as [string, ...string[]];

export const ramadanRiskSchema = z.object({
  answers: z
    .array(
      z
        .object({
          item: z.enum(RISK_ITEM_IDS),
          option: z.string().trim().min(1).max(50),
        })
        .refine(
          ({ item, option }) =>
            RISK_ITEMS.find((candidate) => candidate.id === item)?.options.some((o) => o.id === option),
          'option does not belong to item'
        )
    )
    .max(RISK_ITEMS.length)
    .default([]),
});

export const glucoseLogSchema = z
  .object({
    text: z.string().trim().min(1).max(500).optional(),
    value: z.number().positive().max(2000).optional(),
    unit: z.enum(['mg_dl', 'mmol_l']).optional(),
    symptoms: z.array(z.enum(SYMPTOMS)).max(SYMPTOMS.length).default([]),
    source: z.enum(['typed', 'voice', 'photo']).default('typed'),
    /** Set when the patient has confirmed a value Tabeeb asked them to check. */
    confirmed: z.boolean().default(false),
  })
  .refine((value) => value.value === undefined || value.unit !== undefined, 'unit is required with value')
  .refine(
    (value) => value.text !== undefined || value.value !== undefined || value.symptoms.length > 0,
    'Send a reading, or the symptoms you have'
  );

export const glucoseLogUpdateSchema = z.object({
  fastBroken: z.literal(true),
});

export const reminderToggleSchema = z.object({
  kind: z.enum(['medicine', 'glucose_check', 'sehri', 'iftar']),
  slot: z.enum(['sehri', 'midday', 'pre_iftar', 'iftar', 'post_iftar', 'bedtime']),
  medicationId: z.uuid().nullable().default(null),
  label: z.string().trim().min(1).max(500),
  active: z.boolean(),
});

export const voiceAnswerSchema = z.object({
  item: z.enum(RISK_ITEM_IDS),
  transcript: z.string().trim().min(1).max(1000),
});

export const planShareSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(24 * 30),
});

export const uuidParamSchema = z.uuid('Invalid id');

/** Parses, or throws an ApiError carrying the first readable message. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue.path.join('.');
  throw badRequest(path ? `${path}: ${issue.message}` : issue.message);
}

export function parseSearchParams<T>(schema: z.ZodType<T>, params: URLSearchParams): T {
  return parseOrThrow(schema, Object.fromEntries(params.entries()));
}

/** Body may be absent or malformed; both must be a 400, not an unhandled throw. */
export async function parseJsonBody<T>(schema: z.ZodType<T>, request: Request): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  return parseOrThrow(schema, body);
}

/**
 * Upload validation. The size and type checks previously lived only in the upload
 * page, so a direct POST bypassed both entirely.
 */
export function validateUploadFile(file: File): void {
  if (file.size === 0) {
    throw badRequest('The uploaded file is empty.');
  }
  if (file.size > MAX_FILE_SIZE) {
    const mb = Math.round(MAX_FILE_SIZE / (1024 * 1024));
    throw badRequest(`File is too large. Maximum size is ${mb}MB.`);
  }

  const mime = (file.type || '').toLowerCase().split(';')[0].trim();
  if (!mime) {
    throw badRequest('The file type could not be determined. Please try a different file.');
  }
  if (!SUPPORTED_MIME_TYPES.has(mime)) {
    throw badRequest(
      `Files of type "${mime}" are not supported. Upload a PDF, image, DOCX or text file.`
    );
  }
}
