import { z } from 'zod';
import { badRequest } from './api-error';
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE } from './constants';

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

export const revokeShareSchema = z.object({
  token: z.string().trim().min(1).max(255),
});

export const confirmExtractionSchema = z.object({
  correctedText: z.string().max(500_000).optional(),
  structuredData: z.record(z.string(), z.unknown()).optional(),
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
