import { createHash } from 'node:crypto';
import type {
  MedicationEvidence, MedicationRecord, MedicationStatus, MedicationTimelineEvent,
  PrescriptionComparison, ReconciliationDifference,
} from './types';

export const MAX_EVALUATION_RECORDS = 500;

export function stableMedicationId(prefix: string, parts: unknown[]): string {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)}`;
}

export function normalizedText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function assertMedicationScope(userId: string, records: MedicationRecord[]): void {
  if (records.length > MAX_EVALUATION_RECORDS) throw new Error('Medication evaluation exceeds its bounded record window.');
  if (records.some((record) => record.userId !== userId)) throw new Error('Medication patient scope mismatch.');
}

export function hasDocumentedStopInstruction(name: string, source: string): boolean {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  const stopBefore = new RegExp(`\\b(?:stop|stopped|discontinue|discontinued)\\s+(?:taking\\s+)?${escaped}(?:\\b|$)`, 'i');
  const stopAfter = new RegExp(`${escaped}(?:\\s+\\d+(?:\\.\\d+)?\\s*(?:mg|g|ml|mcg))?\\s*(?::|[-–])?\\s*(?:is\\s+|was\\s+)?(?:stopped|discontinued)\\b`, 'i');
  return source.split(/[;\n.]/).some((clause) =>
    !/\b(?:if|when|unless|after|until|tomorrow|next|not|never|don't|consider|may|might|avoid)\b/i.test(clause) &&
    (stopBefore.test(clause) || stopAfter.test(clause))
  );
}

export function hasExplicitStop(record: MedicationRecord): boolean {
  if (!record.observation.explicitStop) return false;
  return hasDocumentedStopInstruction(
    record.observation.originalName ?? record.name,
    [record.observation.instructions, record.observation.excerpt].filter(Boolean).join('\n')
  );
}

export function medicationStatus(record: MedicationRecord): MedicationStatus {
  if (record.patientStatus) return record.patientStatus;
  if (hasExplicitStop(record)) return 'discontinued';
  const status = record.observation.status;
  // Confirmation is a patient action; extraction cannot establish actual current use.
  if (status === 'confirmed_current' || (status === 'discontinued' && !hasExplicitStop(record))) return 'unknown';
  return status ?? 'prescribed_unconfirmed';
}

export function medicationEvidence(record: MedicationRecord): MedicationEvidence {
  return {
    medicationId: record.id, documentId: record.documentId,
    documentTitle: record.documentTitle, documentDate: record.documentDate,
    page: record.observation.sourcePage ?? null, excerpt: record.observation.excerpt ?? null,
    kind: 'document',
  };
}

/** No fuzzy matching: unresolved names may only be grouped by literal documented spelling. */
export function medicationIdentityKey(record: MedicationRecord): string {
  const identity = record.observation.normalization;
  if (identity?.status === 'verified') {
    if (identity.ingredients.length) {
      return `ingredients:${identity.ingredients.map((item) => (item.rxcui && item.rxcui !== '0' ? item.rxcui : normalizedText(item.name))).sort().join(',')}`;
    }
    if (identity.rxcui) return `concept:${identity.rxcui}`;
  }
  return `documented-name:${normalizedText(record.observation.originalName ?? record.name)}`;
}

export function exactSourceDate(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value)) return null;
  const day = value.slice(0, 10);
  const stamp = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day ? stamp : null;
}

export function medicationSourceDate(record: MedicationRecord): string | null {
  return record.observation.prescribedDateText ?? record.documentDate;
}

function chronological(records: MedicationRecord[]): MedicationRecord[] {
  return [...records].sort((a, b) => {
    const first = exactSourceDate(medicationSourceDate(a));
    const second = exactSourceDate(medicationSourceDate(b));
    if (first !== null && second !== null && first !== second) return first - second;
    if (first === null && second !== null) return 1;
    if (second === null && first !== null) return -1;
    return a.id.localeCompare(b.id);
  });
}

const FIELDS = ['dosage', 'doseAmount', 'strength', 'frequency', 'duration', 'route', 'form', 'instructions'] as const;
export function medicationFieldLabel(field: ReconciliationDifference['field']): string {
  return field === 'doseAmount' ? 'dose amount' : field;
}
function documentedField(record: MedicationRecord, field: (typeof FIELDS)[number]): string | null {
  if (field === 'strength') return [record.observation.strength, record.observation.unit].filter(Boolean).join(' ') || null;
  if (field === 'form' || field === 'instructions' || field === 'doseAmount') return record.observation[field] ?? null;
  return record[field];
}

export function medicationDifferences(first: MedicationRecord, second: MedicationRecord): ReconciliationDifference[] {
  if (first.userId !== second.userId) throw new Error('Medication patient scope mismatch.');
  return FIELDS.flatMap((field) => {
    const before = documentedField(first, field);
    const after = documentedField(second, field);
    // Missing information is handled separately; absence is not a treatment change.
    if (!before || !after || normalizedText(before) === normalizedText(after)) return [];
    return [{
      id: stableMedicationId('difference', [first.userId, first.id, second.id, field, before, after]),
      medicationIds: [first.id, second.id] as [string, string],
      field, before, after,
      explanation: `The sources document different ${medicationFieldLabel(field)} values. These may describe separate treatment episodes; neither source is automatically preferred.`,
      evidence: [medicationEvidence(first), medicationEvidence(second)],
    }];
  });
}

export function comparePrescriptions(
  records: MedicationRecord[], firstDocumentId: string, secondDocumentId: string
): PrescriptionComparison {
  if (records.length > MAX_EVALUATION_RECORDS) throw new Error('Medication comparison exceeds its bounded record window.');
  if (new Set(records.map((record) => record.userId)).size > 1) throw new Error('Medication patient scope mismatch.');
  const first = records.filter((row) => row.sourceActive && row.documentId === firstDocumentId);
  const second = records.filter((row) => row.sourceActive && row.documentId === secondDocumentId);
  const differences: ReconciliationDifference[] = [];
  for (const before of first) {
    for (const after of second) {
      if (before.id === after.id || medicationIdentityKey(before) !== medicationIdentityKey(after)) continue;
      differences.push(...medicationDifferences(before, after));
    }
  }
  const firstKeys = new Set(first.map(medicationIdentityKey));
  const secondKeys = new Set(second.map(medicationIdentityKey));
  return {
    documentIds: [firstDocumentId, secondDocumentId],
    differences,
    onlyInFirst: first.filter((row) => !secondKeys.has(medicationIdentityKey(row))).map((row) => row.id),
    onlyInSecond: second.filter((row) => !firstKeys.has(medicationIdentityKey(row))).map((row) => row.id),
    limitations: [
      'An omitted medicine is not assumed discontinued, and a newer document does not automatically replace an older prescription.',
      'Unverified names are compared only when their documented spellings match. Unmatched identities require review.',
      'Comparison uses original documented values; patient corrections remain separately attributed.',
    ],
  };
}

export function buildMedicationTimeline(userId: string, records: MedicationRecord[]): MedicationTimelineEvent[] {
  assertMedicationScope(userId, records);
  const timeline: MedicationTimelineEvent[] = [];
  const previous = new Map<string, MedicationRecord>();
  for (const record of chronological(records)) {
    const key = medicationIdentityKey(record);
    const prior = previous.get(key);
    const evidence = [medicationEvidence(record)];
    const push = (type: MedicationTimelineEvent['type'], title: string, description: string,
      confirmation: MedicationTimelineEvent['confirmation'] = 'documented', linked = evidence) => {
      timeline.push({
        id: stableMedicationId('event', [userId, type, record.id, description]),
        userId, type, medicationIds: linked.flatMap((item) => item.medicationId ? [item.medicationId] : []),
        date: medicationSourceDate(record), title, description, confirmation, evidence: linked,
      });
    };
    push(prior ? 'new_prescription' : 'first_documented', record.name,
      prior ? 'Another source documents this medication. Current use remains separately confirmed.'
        : 'First represented source for this identity in this view; the treatment start date is not inferred.');
    if (hasExplicitStop(record)) push('explicit_discontinuation', `Documented stop: ${record.name}`,
      record.observation.instructions ?? record.observation.excerpt ?? 'The source explicitly documents discontinuation.');
    if (record.observation.status === 'changed' && record.observation.explicitReplacement && record.observation.excerpt &&
        /\b(?:replace|replaced|switch|switched)\b/i.test(record.observation.excerpt)) {
      push('replacement', `Documented replacement: ${record.name}`,
        `Source records a replacement involving ${record.observation.explicitReplacement}. Verify the original instructions.`);
    }
    if (prior && prior.documentId !== record.documentId) {
      for (const difference of medicationDifferences(prior, record)) {
        const type: MedicationTimelineEvent['type'] =
          difference.field === 'instructions' ? 'reconciliation_conflict' :
          difference.field === 'dosage' || difference.field === 'doseAmount' ? 'dose_change' :
          `${difference.field}_change` as MedicationTimelineEvent['type'];
        push(type, `${record.name}: documented ${medicationFieldLabel(difference.field)} difference`,
          `One source records ${difference.before}; the other records ${difference.after}. ${difference.explanation}`,
          'needs_verification', difference.evidence);
      }
    }
    if (record.patientStatus) {
      timeline.push({
        id: stableMedicationId('event', [userId, 'patient_confirmation', record.id, record.patientStatus]),
        userId, type: 'patient_confirmation', medicationIds: [record.id], date: record.patientUpdatedAt ?? null,
        title: `${record.name}: patient status update`,
        description: `Patient-reported status: ${record.patientStatus.replaceAll('_', ' ')}. This does not change the source document.`,
        confirmation: 'patient_reported', evidence: [{ ...medicationEvidence(record), kind: 'patient', excerpt: null }],
      });
    }
    if (Object.keys(record.corrections).length) {
      timeline.push({
        id: stableMedicationId('event', [userId, 'patient_correction', record.id, record.corrections]),
        userId, type: 'patient_correction', medicationIds: [record.id], date: record.patientUpdatedAt ?? null,
        title: `${record.name}: patient correction`,
        description: 'Patient-entered corrections are recorded separately from the original documented instructions.',
        confirmation: 'patient_reported', evidence: [{ ...medicationEvidence(record), kind: 'patient', excerpt: null }],
      });
    }
    previous.set(key, record);
  }
  return timeline.sort((a, b) => {
    const first = exactSourceDate(a.date);
    const second = exactSourceDate(b.date);
    if (first !== null && second !== null && first !== second) return first - second;
    if (first === null && second !== null) return 1;
    if (second === null && first !== null) return -1;
    return a.id.localeCompare(b.id);
  });
}
