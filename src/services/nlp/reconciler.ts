import type { ValidatedExtraction } from '@/services/extraction-schema';
import { extractMedicalEntities, type MedicalEntity } from './medical-ner';
import { normalizeDrugNames, stripDrugNameNoise } from './drug-normalizer';

/**
 * Cross-checks the LLM extraction against an independent NER read and against RxNorm.
 *
 * Corrections are applied to drug names (RxNorm is authoritative on spelling), but entities the
 * NER found and the LLM missed are only ever reported, never auto-inserted — an unverified
 * medication in a health record is more dangerous than a missing one.
 */

export interface ReconciliationResult {
  extraction: ValidatedExtraction;
  /** Human-readable notes for the review UI. */
  notes: string[];
  correctedDrugCount: number;
  missedEntities: MedicalEntity[];
}

/** Only reasonably confident NER hits are worth showing; below this the noise annoys the patient. */
const MIN_REPORTED_SCORE = 0.6;

/** Beyond this the notes column becomes unreadable, so the rest are summarized as a count. */
const MAX_REPORTED_MISSES = 5;

function normalizeForComparison(value: string): string {
  return stripDrugNameNoise(value).toLowerCase();
}

function mentionedIn(candidate: string, haystack: string[]): boolean {
  const needle = normalizeForComparison(candidate);
  if (needle.length < 3) return true;
  return haystack.some((entry) => entry.includes(needle) || needle.includes(entry));
}

async function applyDrugNormalization(
  extraction: ValidatedExtraction
): Promise<{ medications: ValidatedExtraction['medications']; corrections: string[] }> {
  const names = extraction.medications.map((medication) => medication.name ?? '');
  const normalized = await normalizeDrugNames(names);
  const corrections: string[] = [];

  const medications = extraction.medications.map((medication, index) => {
    const match = normalized[index];
    if (!match?.rxcui) return medication;

    if (match.corrected) {
      corrections.push(`"${match.original}" → "${match.name}"`);
    }

    return {
      ...medication,
      // RxNorm is authoritative on ingredient spelling; the raw reading stays in genericName's
      // place only when the model did not supply one.
      genericName: medication.genericName ?? match.name,
      rxnormId: match.rxcui,
    };
  });

  return { medications, corrections };
}

function findMissedEntities(
  entities: MedicalEntity[],
  extraction: ValidatedExtraction
): MedicalEntity[] {
  const knownDrugs = extraction.medications
    .flatMap((medication) => [medication.name, medication.genericName])
    .filter((value): value is string => Boolean(value))
    .map(normalizeForComparison);

  // A drug named only in the allergy section still reads as a medication to the recognizer, so
  // allergens count as accounted for — otherwise every allergy is reported as a missed drug.
  const knownAllergens = extraction.allergies
    .map((allergy) => allergy.allergen)
    .filter((value): value is string => Boolean(value))
    .map(normalizeForComparison);

  const knownConditions = extraction.diagnoses
    .map((diagnosis) => diagnosis.condition)
    .filter((value): value is string => Boolean(value))
    .map(normalizeForComparison);

  const knownLabs = extraction.labResults
    .map((lab) => lab.testName)
    .filter((value): value is string => Boolean(value))
    .map(normalizeForComparison);

  return entities.filter((entity) => {
    if (entity.score < MIN_REPORTED_SCORE) return false;
    switch (entity.type) {
      case 'medication':
        return !mentionedIn(entity.text, [...knownDrugs, ...knownAllergens]);
      case 'condition':
        return !mentionedIn(entity.text, knownConditions);
      case 'lab_test':
        return !mentionedIn(entity.text, knownLabs);
      default:
        // Dosage and frequency only make sense attached to a drug, so they are not reported alone.
        return false;
    }
  });
}

function describeMisses(missed: MedicalEntity[]): string | null {
  if (missed.length === 0) return null;

  const shown = missed.slice(0, MAX_REPORTED_MISSES).map((entity) => entity.text);
  const remainder = missed.length - shown.length;
  const list = shown.join(', ') + (remainder > 0 ? `, and ${remainder} more` : '');

  return `Our medical language model also spotted these terms in the document that were not added to your health record: ${list}. Please check the original and add anything that belongs.`;
}

export async function reconcileExtraction(
  text: string,
  extraction: ValidatedExtraction
): Promise<ReconciliationResult> {
  const [entities, drugs] = await Promise.all([
    extractMedicalEntities(text),
    applyDrugNormalization(extraction),
  ]);

  const reconciled: ValidatedExtraction = { ...extraction, medications: drugs.medications };
  const missedEntities = findMissedEntities(entities, reconciled);

  const notes: string[] = [];
  if (drugs.corrections.length > 0) {
    notes.push(
      `Medicine names were matched against the RxNorm drug dictionary and corrected: ${drugs.corrections.join(', ')}. Please confirm these against the original document.`
    );
  }

  const missNote = describeMisses(missedEntities);
  if (missNote) notes.push(missNote);

  return {
    extraction: reconciled,
    notes,
    correctedDrugCount: drugs.corrections.length,
    missedEntities,
  };
}
