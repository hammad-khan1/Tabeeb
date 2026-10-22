import {
  assertMedicationScope, buildMedicationTimeline, medicationDifferences, medicationEvidence,
  medicationFieldLabel, medicationIdentityKey, medicationStatus, normalizedText, stableMedicationId,
} from './reconciliation';
import {
  checkMedicationInteractions, usableMedicationIdentity, type InteractionProvider,
} from './interaction-provider';
import type {
  FindingCategory, KnowledgeSource, MedicationAllergy, MedicationEvidence, MedicationEvaluation,
  MedicationRecord, SafetyFinding,
} from './types';

const RXNORM_URL = 'https://www.nlm.nih.gov/research/umls/rxnorm/overview.html';
const CANDIDATE_STATUSES = new Set(['confirmed_current', 'prescribed_unconfirmed', 'unknown']);
const MAX_FINDINGS = 2_000;

function candidate(record: MedicationRecord): boolean {
  return record.sourceActive && CANDIDATE_STATUSES.has(medicationStatus(record));
}

function patientEvidence(record: MedicationRecord): MedicationEvidence[] {
  return Object.keys(record.corrections).length
    ? [{ ...medicationEvidence(record), kind: 'patient', excerpt: null }]
    : [];
}

function value(record: MedicationRecord, field: 'dosage' | 'frequency' | 'duration' | 'route' | 'strength' | 'doseAmount' | 'instructions') {
  if (Object.hasOwn(record.corrections, field)) return record.corrections[field] ?? null;
  if (field === 'strength' || field === 'doseAmount' || field === 'instructions') return record.observation[field] ?? null;
  return record[field];
}

function allergyEvidence(allergy: MedicationAllergy): MedicationEvidence {
  return {
    medicationId: null, documentId: allergy.documentId, documentTitle: allergy.documentTitle ?? null,
    documentDate: null, page: null, excerpt: allergy.allergen, kind: 'allergy_record', allergyId: allergy.id,
  };
}

function exactDuplicate(a: MedicationRecord, b: MedicationRecord): boolean {
  const sameDocument = a.documentId !== null && a.documentId === b.documentId;
  const sameSourceContent = Boolean(
    a.observation.sourceFingerprint && b.observation.sourceFingerprint &&
    a.observation.sourceFingerprint === b.observation.sourceFingerprint
  );
  if (!sameDocument && !sameSourceContent) return false;
  // Repeated occurrences in one source are flagged as possible duplicate entries, never a
  // proven double dose. Separate imports require identical full-source fingerprints,
  // not just matching medication names or instruction excerpts.
  return JSON.stringify([
    normalizedText(a.name), a.dosage, a.frequency, a.duration, a.route,
    a.observation.strength, a.observation.unit, a.observation.form, a.observation.doseAmount,
    a.observation.instructions, a.observation.excerpt, a.observation.sourcePage,
  ]) === JSON.stringify([
    normalizedText(b.name), b.dosage, b.frequency, b.duration, b.route,
    b.observation.strength, b.observation.unit, b.observation.form, b.observation.doseAmount,
    b.observation.instructions, b.observation.excerpt, b.observation.sourcePage,
  ]);
}

/** All clinical findings are deterministic or attributed to an injected validated provider. */
export async function evaluateMedicationSafety(
  userId: string, records: MedicationRecord[], allergies: MedicationAllergy[],
  options: { now?: string; interactionProvider?: InteractionProvider } = {}
): Promise<MedicationEvaluation> {
  assertMedicationScope(userId, records);
  if (allergies.some((row) => row.userId !== userId)) throw new Error('Allergy patient scope mismatch.');
  if (allergies.length > 2_000) throw new Error('Allergy evaluation exceeds its bounded record window.');
  const now = options.now ?? new Date().toISOString();
  const findings: SafetyFinding[] = [];
  const findingIds = new Set<string>();
  const limitations = [
    'Prescription evidence does not confirm actual use. Potential concurrent-use findings require review with a pharmacist or clinician.',
    'Therapeutic duplication and allergy cross-reactivity are unsupported without validated classification or relationship data. Similar names are not treated as related.',
    'Unknown medication identities, local brands, missing evidence and outdated source information can limit screening.',
  ];
  let capped = false;
  const add = (
    category: FindingCategory, involved: MedicationRecord[], title: string, explanation: string,
    certainty: SafetyFinding['certainty'], basis: unknown,
    extra: { evidence?: MedicationEvidence[]; source?: KnowledgeSource | null; severity?: string | null } = {}
  ) => {
    if (findings.length >= MAX_FINDINGS) { capped = true; return; }
    const medicationIds = involved.map((record) => record.id).sort();
    const id = stableMedicationId('finding', [userId, category, medicationIds, basis]);
    if (findingIds.has(id)) return;
    findingIds.add(id);
    findings.push({
      id, userId, category, medicationIds, title, explanation, certainty,
      severity: extra.severity ?? null,
      evidence: [...involved.map(medicationEvidence), ...involved.flatMap(patientEvidence), ...(extra.evidence ?? [])],
      knowledgeSource: extra.source ?? null, detectedAt: now,
      reviewStatus: certainty === 'uncertain' || certainty === 'possible' ? 'needs_verification' : 'open',
      resolutionNotes: null, current: true,
    });
  };
  const active = records.filter(candidate).sort((a, b) => a.id.localeCompare(b.id));
  for (const record of active) {
    const identity = usableMedicationIdentity(record);
    if (!identity) {
      add('uncertain_identity', [record], 'Verify medication identity',
        `The identity of ${record.corrections.name ?? record.name} is unresolved or has been corrected since verification. Ingredient and drug-interaction checks may be incomplete.`,
        'uncertain', ['identity', record.corrections.name ?? record.name, record.observation.normalization?.status ?? 'unresolved']);
    } else if (!identity.ingredients.length) {
      add('uncertain_identity', [record], 'Ingredient information is incomplete',
        `${record.name} has a verified terminology concept but no verified ingredient list. Ingredient checks remain incomplete.`,
        'uncertain', ['missing_ingredients', identity.rxcui]);
    }
    const missing: string[] = [];
    if (!value(record, 'dosage') && !value(record, 'doseAmount')) missing.push('dose');
    if (!value(record, 'strength') && !/\d\s*(?:mg|mcg|µg|g|ml|units?|iu|%)/i.test(value(record, 'dosage') ?? '')) missing.push('strength');
    if (!value(record, 'frequency')) missing.push('frequency');
    if (/\binj(?:ection)?\b/i.test(record.observation.form ?? '') && !value(record, 'route')) missing.push('route for the documented injection');
    if (record.observation.durationExpected && !value(record, 'duration')) missing.push('explicitly expected duration');
    if (missing.length) {
      add('missing_information', [record], 'Instructions need verification',
        `The record does not specify ${missing.join(', ')}. This is a documentation gap, not a conclusion that the prescription is unsafe. Verify the original instructions with a pharmacist or clinician.`,
        'documented', ['missing', missing]);
    }
    const instructions = [value(record, 'instructions'), value(record, 'frequency'), value(record, 'dosage')].filter(Boolean).join(' ');
    const ambiguous = instructions.match(/\b(?:OD|OS|OU|AD|AS|AU|QD|QOD|U)\b/g);
    if (ambiguous) {
      add('missing_information', [record], 'Abbreviation needs clarification',
        `The documented abbreviation ${[...new Set(ambiguous)].join(', ')} can be unclear without context. Preserve and verify the original directions; no dosing interpretation was inferred.`,
        'uncertain', ['abbreviations', [...new Set(ambiguous)].sort()]);
    }
    const allKnownAllergies = allergies.filter((row) =>
      !row.assertionStatus || row.assertionStatus === 'present'
    );
    for (const allergy of allKnownAllergies) {
      const allergen = normalizedText(allergy.allergen);
      if (!allergen || /^(?:drug|drugs|medication|medicine|antibiotic|antibiotics|unknown|other|none|nkda|no known.*)$/.test(allergen)) continue;
      const currentName = Object.hasOwn(record.corrections, 'name')
        ? record.corrections.name : record.observation.originalName ?? record.name;
      const exact = normalizedText(currentName) === allergen;
      const matchingIngredient = identity?.ingredients.find((ingredient) =>
        normalizedText(ingredient.name) === allergen || allergy.verifiedIngredientIds?.includes(ingredient.rxcui)
      );
      if (!exact && !matchingIngredient) continue;
      add('allergy_concern', [record], 'Recorded allergy matches medication',
        exact
          ? `The documented medicine name matches the recorded allergen “${allergy.allergen}”. Review the original allergy and medicine records with a pharmacist or clinician.`
          : `RxNorm identifies ${matchingIngredient!.name} as an ingredient, matching the recorded allergen “${allergy.allergen}”. This is an ingredient match; no cross-reactivity was inferred.`,
        exact ? 'documented' : 'verified', ['allergy', allergy.id, matchingIngredient?.rxcui ?? allergen],
        {
          evidence: [allergyEvidence(allergy)],
          source: matchingIngredient ? { provider: 'RxNorm', version: identity!.version, checkedAt: identity!.checkedAt, url: RXNORM_URL } : null,
        });
    }
  }

  for (let index = 0; index < active.length; index += 1) {
    const first = active[index];
    for (const second of active.slice(index + 1)) {
      if (exactDuplicate(first, second)) {
        add('exact_duplicate', [first, second], 'Possible duplicate source entry',
          'These entries contain the same medication details in the same document or in imports with identical complete extracted text. OCR may omit distinctions, so this is a possible repeated entry or import, not proof of an identical prescription event or two doses taken.',
          'possible', ['same_source', first.documentId === second.documentId ? first.documentId : first.observation.sourceFingerprint]);
      }
      const a = usableMedicationIdentity(first);
      const b = usableMedicationIdentity(second);
      const shared = a?.ingredients.filter((ingredient) =>
        b?.ingredients.some((other) =>
          (ingredient.rxcui && ingredient.rxcui !== '0' && other.rxcui === ingredient.rxcui) ||
          normalizedText(other.name) === normalizedText(ingredient.name)
        )
      ) ?? [];
      if (shared.length) {
        const providerName = a?.provider === 'Pharmapedia' || b?.provider === 'Pharmapedia' ? 'Pharmapedia / Pakistan Medicine Catalog' : 'RxNorm';
        add('ingredient_duplication', [first, second], 'Verified ingredient overlap',
          `${first.name} and ${second.name} share ${shared.map((item) => item.name).join(', ')} according to ${providerName}. Strengths, formulations and treatment episodes may differ. This is not proof of a prescribing error or simultaneous use; ask a pharmacist or clinician to reconcile them.`,
          'verified', ['ingredients', shared.map((item) => (item.rxcui && item.rxcui !== '0' ? item.rxcui : normalizedText(item.name))).sort()],
          { source: { provider: (a?.provider ?? 'RxNorm') as 'RxNorm', version: a!.version, checkedAt: a!.checkedAt, url: a?.provider === 'Pharmapedia' ? 'local-data/pharmapedia.db' : RXNORM_URL } });
      }
      if (medicationIdentityKey(first) !== medicationIdentityKey(second)) continue;
      for (const difference of medicationDifferences(first, second)) {
        const sameSource = first.documentId === second.documentId;
        const bothCurrent = first.patientStatus === 'confirmed_current' && second.patientStatus === 'confirmed_current';
        add(sameSource || bothCurrent ? 'conflicting_instructions' : 'reconciliation_difference',
          [first, second], `Different documented ${medicationFieldLabel(difference.field)}`,
          `One source records “${difference.before}”; the other records “${difference.after}”. ${difference.explanation}`,
          'possible', [difference.field, difference.before, difference.after]);
      }
    }
  }
  const interactions = await checkMedicationInteractions(active, options.interactionProvider, now);
  const byId = new Map(active.map((row) => [row.id, row]));
  for (const interaction of interactions.interactions) {
    const involved = interaction.medicationIds.map((id) => byId.get(id)!);
    add('drug_interaction', involved, 'Provider-reported drug interaction',
      `${interaction.description} Evidence: ${interaction.evidenceBasis} Discuss the finding with a pharmacist or clinician before changing any medicine.`,
      'verified', [interaction.provider, interaction.version, interaction.description, interaction.referenceUrl],
      { severity: interaction.severity, source: {
        provider: interaction.provider, version: interaction.version, url: interaction.referenceUrl, checkedAt: now,
      } });
  }
  if (capped) limitations.push(`Only the first ${MAX_FINDINGS} findings are shown. Remaining potential findings require a narrower review.`);
  return {
    findings, timeline: buildMedicationTimeline(userId, records), interactionCoverage: interactions.coverage,
    limitations: [...limitations, ...interactions.coverage.limitations], evaluatedAt: now,
  };
}
