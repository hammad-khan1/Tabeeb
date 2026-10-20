import { createHash } from 'node:crypto';
import { clamp, safeDate, type ValidatedExtraction } from '@/services/extraction-schema';
import { limitConcurrency } from '@/lib/concurrency';
import { findPageNumber } from '@/services/briefing/doctor-tracker';
import { normalizeMedicationIdentity } from './normalization';
import { exactSourceDate, hasDocumentedStopInstruction } from './reconciliation';
import type { MedicationObservation, MedicationStatus } from './types';

type ExtractedMedication = ValidatedExtraction['medications'][number];

/** Stable across array reordering; same-name variants retain their own provenance. */
export function medicationSourceKeys(medications: ExtractedMedication[]): string[] {
  const occurrences = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const medication of medications) {
    const name = (medication.name ?? '').normalize('NFKC').trim().toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return medications.map((medication) => {
    const name = (medication.name ?? '').normalize('NFKC').trim().toLowerCase();
    // A lone medicine can retain its key after corrected OCR dosage. When several
    // same-name observations exist, include their directions to avoid swapping
    // patient corrections between different strengths on reorder.
    const identity = counts.get(name)! > 1
      ? JSON.stringify([
          name, medication.dosage, medication.strength, medication.unit, medication.form,
          medication.route, medication.frequency, medication.duration, medication.doseAmount,
          medication.startDate, medication.endDate, medication.instructions,
        ])
      : name;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return createHash('sha256').update(`${identity}\0${occurrence}`).digest('hex');
  });
}

/** Partial/approximate dates remain text and never become a fabricated first day. */
export function exactMedicationDate(value: string | undefined): Date | null {
  if (!value || exactSourceDate(value) === null) return null;
  return safeDate(value);
}

/**
 * Model excerpts are checked against the extracted source; invented quotes and page
 * numbers never become provenance. The extractor does not yet expose page offsets.
 */
export function medicationExcerpt(medication: ExtractedMedication, text: string): string | null {
  const name = medication.name?.trim();
  if (!name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const containsName = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu');
  const supplied = medication.excerpt?.trim();
  if (supplied && text.includes(supplied) && containsName.test(supplied)) return supplied.slice(0, 2000);
  return text.split(/\r?\n/).find((line) => containsName.test(line))?.trim().slice(0, 2000) ?? null;
}

function documentedReplacement(name: string, replacement: string, text: string): boolean {
  const escape = (value: string) => value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = escape(name);
  const target = escape(replacement);
  if (!source || !target) return false;
  const patterns = [
    new RegExp(`\\b(?:replace|replaced|switch|switched)\\s+(?:from\\s+)?${source}\\s+(?:with|to)\\s+${target}(?:\\b|$)`, 'i'),
    new RegExp(`${source}\\s+(?:was\\s+|is\\s+)?replaced\\s+(?:with|by)\\s+${target}(?:\\b|$)`, 'i'),
  ];
  return text.split(/[;\n.]/).some((clause) =>
    !/\b(?:if|when|unless|after|until|tomorrow|next|not|never|don't|consider|may|might|avoid)\b/i.test(clause) &&
    patterns.some((pattern) => pattern.test(clause))
  );
}

export function documentedMedicationStatus(
  medication: ExtractedMedication,
  excerpt: string | null,
  uncertain: boolean
): MedicationStatus {
  if (uncertain || !excerpt) return 'unknown';
  const name = medication.name?.trim().toLowerCase();
  if (!name) return 'unknown';
  const text = excerpt.toLowerCase();
  if (/\b(?:no|not taking|denies|not prescribed)\b/.test(text) && !hasDocumentedStopInstruction(name, text)) return 'unknown';
  const explicitStop = hasDocumentedStopInstruction(name, text);
  if (explicitStop) return 'discontinued';
  if (medication.explicitStop || medication.status === 'discontinued') return 'unknown';
  if (medication.explicitReplacement) {
    return documentedReplacement(name, medication.explicitReplacement, text) ? 'changed' : 'unknown';
  }
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
  if (input.data.medications.length > 200) {
    throw new Error('This source exceeds the supported medication extraction limit. Split the source into smaller documents.');
  }
  const keys = medicationSourceKeys(input.data.medications);
  const sourceFingerprint = input.text.trim()
    ? createHash('sha256').update(input.text).digest('hex')
    : null;
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
    const instructions = medication.instructions && excerpt?.includes(medication.instructions)
      ? medication.instructions.slice(0, 2000) : excerpt;
    const observation: MedicationObservation = {
      originalName: name,
      brandName: clamp(medication.brandName, 500),
      strength: clamp(medication.strength, 255),
      unit: clamp(medication.unit, 100),
      form: clamp(medication.form, 100),
      doseAmount: clamp(medication.doseAmount, 255),
      startDate: clamp(medication.startDate, 100),
      prescribedDateText: clamp(medication.prescribedDate, 100),
      endDate: clamp(medication.endDate, 100),
      prescriber: clamp(medication.prescriber ?? input.data.doctorName, 255),
      sourcePage: excerpt ? findPageNumber(input.text, excerpt) : null,
      sourceFingerprint,
      excerpt,
      instructions,
      confidence: uncertain || !excerpt ? 'uncertain' : 'documented',
      status,
      explicitStop: status === 'discontinued',
      explicitReplacement: status === 'changed' ? clamp(medication.explicitReplacement, 500) : null,
      durationExpected: medication.durationExpected === true &&
        /\b(?:duration|course\s+of|for\s+(?:\d+|one|two|three|four|five|six|seven|ten|fourteen)\s+(?:days?|weeks?|months?))\b/i.test(instructions ?? ''),
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
      prescribedDate: medication.prescribedDate ? exactMedicationDate(medication.prescribedDate) : input.documentDate,
      observation: observation as unknown as Record<string, unknown>,
      sourceKey: keys[index],
      sourceActive: true,
      updatedAt: new Date(),
    };
  }).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null));
}

export type PreparedMedicationRow = Awaited<ReturnType<typeof prepareMedicationRows>>[number];
