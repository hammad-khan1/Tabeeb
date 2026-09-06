import { z } from 'zod';

/**
 * The extraction model returns free-form JSON, so every field here is coerced rather
 * than trusted: missing arrays become empty, junk array elements are dropped, and
 * placeholder strings the model emits for "not found" collapse to undefined.
 */

const NULLISH_TEXT = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'null',
  'undefined',
  'none',
  'nil',
  'unknown',
  'not mentioned',
  'not specified',
  'not available',
  'not provided',
]);

const optionalString = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const trimmed = text.trim();
  return NULLISH_TEXT.has(trimmed.toLowerCase()) ? undefined : trimmed;
}, z.string().optional());

const optionalBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'abnormal', 'high', 'low', 'positive', 'active'].includes(text)) return true;
    if (['false', 'no', 'n', '0', 'normal', 'negative', 'inactive'].includes(text)) return false;
  }
  return undefined;
}, z.boolean().optional());

const optionalNumber = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const cleaned = String(value).replace(/,/g, '').trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}, z.number().optional());

const optionalLanguage = z.preprocess((value) => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  return text === 'en' || text === 'ur' || text === 'mixed' ? text : undefined;
}, z.enum(['en', 'ur', 'mixed']).optional());

function arrayOf<T extends z.ZodTypeAny>(element: T) {
  return z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => item !== null && typeof item === 'object')
        : [],
    z.array(element)
  );
}

const medicationSchema = z.object({
  name: optionalString,
  genericName: optionalString,
  dosage: optionalString,
  frequency: optionalString,
  duration: optionalString,
  route: optionalString,
  rxnormId: optionalString,
  isActive: optionalBoolean,
  prescribedDate: optionalString,
});

/**
 * Not something the extraction model produces — the NLP reconciler fills it in from
 * the surrounding text. It lives on the schema so the annotated extraction is still a
 * ValidatedExtraction and can be stored as the document's structured data unchanged.
 */
const assertionStatusSchema = z
  .enum(['present', 'absent', 'family', 'historical', 'hypothetical', 'uncertain'])
  .optional();

const diagnosisSchema = z.object({
  condition: optionalString,
  icd10Code: optionalString,
  severity: optionalString,
  notes: optionalString,
  diagnosedDate: optionalString,
  assertionStatus: assertionStatusSchema,
});

const labResultSchema = z.object({
  testName: optionalString,
  value: optionalString,
  numericValue: optionalNumber,
  unit: optionalString,
  referenceRange: optionalString,
  isAbnormal: optionalBoolean,
  testDate: optionalString,
});

const allergySchema = z.object({
  allergen: optionalString,
  allergyType: optionalString,
  severity: optionalString,
  reaction: optionalString,
  assertionStatus: assertionStatusSchema,
});

export const structuredExtractionSchema = z.object({
  medications: arrayOf(medicationSchema),
  diagnoses: arrayOf(diagnosisSchema),
  labResults: arrayOf(labResultSchema),
  allergies: arrayOf(allergySchema),
  hospital: optionalString,
  doctorName: optionalString,
  documentDate: optionalString,
  documentType: optionalString,
  language: optionalLanguage,
});

export type ValidatedExtraction = z.infer<typeof structuredExtractionSchema>;

const EMPTY_EXTRACTION: ValidatedExtraction = {
  medications: [],
  diagnoses: [],
  labResults: [],
  allergies: [],
};

export function parseStructuredExtraction(raw: unknown): ValidatedExtraction {
  const result = structuredExtractionSchema.safeParse(raw);
  if (result.success) return result.data;

  console.error('[Extraction] Model output failed validation:', result.error.issues);
  return { ...EMPTY_EXTRACTION };
}

export function isExtractionEmpty(data: ValidatedExtraction): boolean {
  return (
    data.medications.length === 0 &&
    data.diagnoses.length === 0 &&
    data.labResults.length === 0 &&
    data.allergies.length === 0
  );
}

/** Clamp to the destination varchar width so a long model string cannot abort the insert. */
export function clamp(value: string | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;

  // Reject dates the model clearly hallucinated rather than read off the page.
  const year = parsed.getUTCFullYear();
  if (year < 1900 || year > new Date().getUTCFullYear() + 1) return null;

  return parsed;
}
