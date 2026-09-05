import type { ValidatedExtraction } from '@/services/extraction-schema';
import { extractMedicalEntities, type MedicalEntity } from './medical-ner';
import { normalizeDrugNames, stripDrugNameNoise } from './drug-normalizer';
import {
  detectAssertions,
  belongsToPatient,
  describeAssertion,
  type Assertion,
} from './assertion';
import { suggestIcd10 } from './condition-linker';

/**
 * Cross-checks the LLM extraction against an independent NER read, against RxNorm, and
 * against what the document actually asserts.
 *
 * Corrections are applied to drug names (RxNorm is authoritative on spelling), but entities the
 * NER found and the LLM missed are only ever reported, never auto-inserted — an unverified
 * medication in a health record is more dangerous than a missing one.
 *
 * Two further passes run over conditions and allergies:
 *
 *  - assertion detection, which decides whether the document says the patient HAS the
 *    finding. The extractor cannot tell "no history of diabetes" from "diabetes", and
 *    a record that inverts a denial is the worst output this pipeline can produce.
 *  - concept linking, which attaches an ICD-10 code so the same disease written four
 *    ways stops looking like four diseases.
 *
 * Both are deterministic and offline, so neither can fail an upload.
 */

export interface ReconciliationResult {
  extraction: ValidatedExtraction;
  /** Human-readable notes for the review UI. */
  notes: string[];
  /** How many names matched an RxNorm concept under a different spelling. */
  identifiedDrugCount: number;
  missedEntities: MedicalEntity[];
  /** Every condition and allergy, with how the document asserts it. */
  assertions: Assertion[];
  /** Findings the document does not attribute to this patient. */
  heldBack: Assertion[];
  /** How many conditions were matched to an ICD-10 concept. */
  linkedConditionCount: number;
}

/** Only reasonably confident NER hits are worth showing; below this the noise annoys the patient. */
const MIN_REPORTED_SCORE = 0.6;

/** Beyond this the notes column becomes unreadable, so the rest are summarized as a count. */
const MAX_REPORTED_MISSES = 5;

/** Same reasoning for held-back findings: enough to be useful, not a wall of text. */
const MAX_REPORTED_HOLD_BACKS = 5;

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
): Promise<{ medications: ValidatedExtraction['medications']; identifications: string[] }> {
  const names = extraction.medications.map((medication) => medication.name ?? '');
  const normalized = await normalizeDrugNames(names);
  const identifications: string[] = [];

  const medications = extraction.medications.map((medication, index) => {
    const match = normalized[index];
    if (!match?.rxcui) return medication;

    if (match.corrected) {
      identifications.push(`"${match.original}" → ${match.name}`);
    }

    return {
      ...medication,
      // `name` deliberately keeps the verbatim reading: it is what is printed on the
      // patient's paper and on the box, so it is what they can check against. The
      // RxNorm spelling only fills genericName when the document did not give one,
      // and the concept id records the link either way.
      //
      // The note this produces used to claim names had been "corrected" while nothing
      // ever wrote back to `name` — so the wording, not the behaviour, was the bug.
      genericName: medication.genericName ?? match.name,
      rxnormId: match.rxcui,
    };
  });

  return { medications, identifications };
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

/**
 * Tags every condition and allergy with how the document asserts it, and records an
 * ICD-10 code for the ones the catalogue recognises.
 *
 * Nothing is removed here. The annotated extraction is what gets stored as the
 * document's structured data, so the review UI can still show a patient everything
 * that was read off their page; it is the health record itself — built in
 * document-processor — that keeps only what the document attributes to them.
 */
function applyClinicalContext(
  text: string,
  extraction: ValidatedExtraction
): {
  extraction: ValidatedExtraction;
  assertions: Assertion[];
  heldBack: Assertion[];
  linkedConditionCount: number;
} {
  const conditions = extraction.diagnoses
    .map((diagnosis) => diagnosis.condition)
    .filter((value): value is string => Boolean(value));
  const allergens = extraction.allergies
    .map((allergy) => allergy.allergen)
    .filter((value): value is string => Boolean(value));

  const asserted = detectAssertions(text, [...conditions, ...allergens]);
  let linkedConditionCount = 0;

  const diagnoses = extraction.diagnoses.map((diagnosis) => {
    const assertion = diagnosis.condition ? asserted.get(diagnosis.condition) : undefined;

    // A code the document itself printed is authoritative; ours only fills a gap.
    const icd10Code = diagnosis.icd10Code ?? (diagnosis.condition ? suggestIcd10(diagnosis.condition) ?? undefined : undefined);
    if (!diagnosis.icd10Code && icd10Code) linkedConditionCount += 1;

    return { ...diagnosis, icd10Code, assertionStatus: assertion?.status ?? 'present' };
  });

  const allergies = extraction.allergies.map((allergy) => {
    const assertion = allergy.allergen ? asserted.get(allergy.allergen) : undefined;
    return { ...allergy, assertionStatus: assertion?.status ?? 'present' };
  });

  const assertions = [...asserted.values()];

  return {
    extraction: { ...extraction, diagnoses, allergies },
    assertions,
    heldBack: assertions.filter((assertion) => !belongsToPatient(assertion.status)),
    linkedConditionCount,
  };
}

export async function reconcileExtraction(
  text: string,
  extraction: ValidatedExtraction
): Promise<ReconciliationResult> {
  const [entities, drugs] = await Promise.all([
    extractMedicalEntities(text),
    applyDrugNormalization(extraction),
  ]);

  const withDrugs: ValidatedExtraction = { ...extraction, medications: drugs.medications };
  const context = applyClinicalContext(text, withDrugs);
  const reconciled = context.extraction;
  const missedEntities = findMissedEntities(entities, reconciled);

  const notes: string[] = [];
  if (drugs.identifications.length > 0) {
    notes.push(
      `These medicine names were read differently from how the RxNorm drug dictionary spells them: ${drugs.identifications.join(', ')}. We kept what the document says and recorded the dictionary name alongside it — please check them against the original.`
    );
  }

  const missNote = describeMisses(missedEntities);
  if (missNote) notes.push(missNote);

  // Held-back findings are always explained. A patient who sees "diabetes" missing
  // from a record must be able to find out that the document denied it, rather than
  // assume the app lost it.
  for (const assertion of context.heldBack.slice(0, MAX_REPORTED_HOLD_BACKS)) {
    const note = describeAssertion(assertion);
    if (note) notes.push(note);
  }

  return {
    extraction: reconciled,
    notes,
    identifiedDrugCount: drugs.identifications.length,
    missedEntities,
    assertions: context.assertions,
    heldBack: context.heldBack,
    linkedConditionCount: context.linkedConditionCount,
  };
}
