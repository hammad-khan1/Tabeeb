import { createHash } from 'node:crypto';
import { clamp, safeDate, type ValidatedExtraction } from '@/services/extraction-schema';
import { limitConcurrency } from '@/lib/concurrency';
import { normalizeMedicationIdentity } from './normalization';
import type { MedicationObservation, MedicationStatus } from './types';

type ExtractedMedication = ValidatedExtraction['medications'][number];

/** Stable across prescription dose corrections and array reordering. */
export function medicationSourceKeys(medications: ExtractedMedication[]): string[] {
  const occurrences = new Map<string, number>();
  return medications.map((medication) => {
    const name = (medication.name ?? '').normalize('NFKC').trim().toLowerCase();
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    return createHash('sha256').update(`${name}\0${occurrence}`).digest('hex');
  });
}

/**
 * Model excerpts are checked against the extracted source; invented quotes and page
 * numbers never become provenance. The extractor does not yet expose page offsets.
 */
export function medicationExcerpt(medication: ExtractedMedication, text: string): string | null {
  const supplied = medication.excerpt?.trim();
  if (supplied && text.includes(supplied)) return supplied.slice(0, 2000);
  const name = medication.name?.trim().toLowerCase();
  if (!name) return null;
  return text.split(/\r?\n/).find((line) => line.toLowerCase().includes(name))?.trim().slice(0, 2000) ?? null;
}

export function documentedMedicationStatus(
  medication: ExtractedMedication,
  excerpt: string | null,
  uncertain: boolean
): MedicationStatus {
  if (uncertain || !excerpt) return 'unknown';
  const text = excerpt.toLowerCase();
  if (/\b(?:do not|don't|never|not to)\s+(?:stop|discontinue)\b/.test(text)) return 'prescribed_unconfirmed';
  if (/\b(?:stop|stopped|discontinue|discontinued)\b/.test(text)) return 'discontinued';
  if (medication.explicitReplacement && /\b(?:replace[ds]?|switch(?:ed)?)\b/.test(text)) return 'changed';
  if (medication.status === 'historical' && /\b(?:previous|historical|formerly|past medication|used to)\b/.test(text)) return 'historical';
  // isActive is not evidence that the patient actually took a prescription.
  return 'prescribed_unconfirmed';
}

export async function prepareMedicationRows(input: {
  documentId: string;
  userId: string;
  data: ValidatedExtraction;
  text: string;
  documentDate: Date | null;
  lowConfidence: boolean;
}) {
  const keys = medicationSourceKeys(input.data.medications);
  return limitConcurrency(input.data.medications, 4, async (medication, index) => {
    const name = clamp(medication.name, 500);
    if (!name) return null;
    const excerpt = medicationExcerpt(medication, input.text);
    const uncertain = input.lowConfidence || medication.uncertain === true ||
      /\[unclear:|[?]/i.test([name, medication.dosage, medication.instructions].filter(Boolean).join(' '));
    const status = documentedMedicationStatus(medication, excerpt, uncertain);
    const normalization = uncertain || !excerpt
      ? {
          status: 'unresolved' as const, normalizedName: null, rxcui: null, conceptType: null,
          ingredients: [], provider: null, version: null, checkedAt: null,
          limitations: ['The extracted medication needs verification against its original source.'],
        }
      : await normalizeMedicationIdentity(name);
    const instructions = medication.instructions && input.text.includes(medication.instructions)
      ? medication.instructions.slice(0, 2000) : excerpt;
    const observation: MedicationObservation = {
      originalName: name,
      brandName: clamp(medication.brandName, 500),
      strength: clamp(medication.strength, 255),
      unit: clamp(medication.unit, 100),
      form: clamp(medication.form, 100),
      doseAmount: clamp(medication.doseAmount, 255),
      startDate: clamp(medication.startDate, 100),
      endDate: clamp(medication.endDate, 100),
      prescriber: clamp(medication.prescriber ?? input.data.doctorName, 255),
      sourcePage: null,
      excerpt,
      instructions,
      confidence: uncertain || !excerpt ? 'uncertain' : 'documented',
      status,
      explicitStop: status === 'discontinued',
      explicitReplacement: status === 'changed' ? clamp(medication.explicitReplacement, 500) : null,
      durationExpected: medication.durationExpected === true &&
        /\b(?:for|duration|course)\b/i.test(instructions ?? ''),
      normalization,
    };
    return {
      documentId: input.documentId,
      userId: input.userId,
      name,
      genericName: clamp(medication.genericName, 500),
      dosage: clamp(medication.dosage, 255),
      frequency: clamp(medication.frequency, 255),
      duration: clamp(medication.duration, 255),
      route: clamp(medication.route, 100),
      // Model-supplied identifiers never reach the normalized medication record.
      rxnormId: normalization.status === 'verified' ? normalization.rxcui : null,
      isActive: status === 'prescribed_unconfirmed',
      prescribedDate: safeDate(medication.prescribedDate) ?? input.documentDate,
      observation: observation as unknown as Record<string, unknown>,
      sourceKey: keys[index],
      sourceActive: true,
      updatedAt: new Date(),
    };
  }).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null));
}

export type PreparedMedicationRow = Awaited<ReturnType<typeof prepareMedicationRows>>[number];
