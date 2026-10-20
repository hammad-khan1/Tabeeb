import { ApiError, notFound } from '@/lib/api-error';
import {
  getMedicationDocument, getMedicationSnapshot, saveSafetyEvaluation,
  type OwnedMedicationSnapshot,
} from './repository';
import { evaluateMedicationSafety } from './safety';
import {
  MAX_EVALUATION_RECORDS, comparePrescriptions, exactSourceDate, medicationEvidence, medicationStatus,
} from './reconciliation';
import type { MedicationEvaluation, MedicationTimelineEvent } from './types';

export interface MedicationWorkspace extends OwnedMedicationSnapshot {
  evaluation: MedicationEvaluation;
  events: MedicationTimelineEvent[];
}

function timelineWithAudit(snapshot: OwnedMedicationSnapshot, evaluation: MedicationEvaluation): MedicationTimelineEvent[] {
  const records = new Map(snapshot.medications.map((row) => [row.id, row]));
  const events = evaluation.timeline.filter((event) =>
    !['patient_confirmation', 'patient_correction'].includes(event.type)
  );
  for (const entry of snapshot.audit) {
    const medication = entry.medicationId ? records.get(entry.medicationId) : undefined;
    if (!medication || !['patient_confirmation', 'patient_correction'].includes(entry.action)) continue;
    events.push({
      id: entry.id, userId: medication.userId,
      type: entry.action as 'patient_confirmation' | 'patient_correction',
      medicationIds: [medication.id], date: entry.createdAt,
      title: `${medication.name}: patient update`,
      description: entry.note ?? 'Patient-reported information; original evidence is preserved.',
      confirmation: 'patient_reported',
      evidence: [{ ...medicationEvidence(medication), kind: 'patient', excerpt: entry.note }],
    });
  }
  return events.sort((a, b) => {
    const left = exactSourceDate(a.date);
    const right = exactSourceDate(b.date);
    if (left === null) return right !== null ? 1 : a.id.localeCompare(b.id);
    if (right === null) return -1;
    return left - right || a.id.localeCompare(b.id);
  });
}

// Coalesce simultaneous dashboard requests without retaining medical data in a shared cache.
const inFlight = new Map<string, Promise<MedicationWorkspace>>();

async function evaluateWorkspace(userId: string): Promise<MedicationWorkspace> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshot = await getMedicationSnapshot(userId);
    const records = snapshot.medications.slice(0, MAX_EVALUATION_RECORDS);
    const evaluation = await evaluateMedicationSafety(userId, records, snapshot.allergies);
    if (snapshot.medications.length > records.length) {
      evaluation.limitations.push(
        `Safety evaluation and source timeline cover the first ${MAX_EVALUATION_RECORDS} records in this view. Older records remain accessible; coverage is incomplete.`
      );
      if (evaluation.interactionCoverage.status === 'available') evaluation.interactionCoverage.status = 'partial';
    }
    if (!await saveSafetyEvaluation(userId, {
      findings: evaluation.findings, snapshotRevision: snapshot.revision,
    })) continue;
    const saved = await getMedicationSnapshot(userId);
    if (saved.revision !== snapshot.revision) continue;
    return {
      ...saved, evaluation,
      limitations: [...(saved.limitations ?? []), ...evaluation.limitations],
      events: timelineWithAudit(saved, evaluation),
    };
  }
  throw new ApiError(409, 'Your medication sources changed during evaluation. Please refresh.');
}

export function getMedicationWorkspace(userId: string): Promise<MedicationWorkspace> {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const pending = evaluateWorkspace(userId).finally(() => { inFlight.delete(userId); });
  inFlight.set(userId, pending);
  return pending;
}

/** Used by the briefing as well as the dashboard; never merges private document scopes. */
export async function compareMedicationDocuments(userId: string, first: string, second: string) {
  await Promise.all([getMedicationDocument(userId, first), getMedicationDocument(userId, second)]);
  const snapshot = await getMedicationSnapshot(userId);
  const records = snapshot.medications.filter((row) => row.documentId === first || row.documentId === second);
  if (records.length > MAX_EVALUATION_RECORDS || snapshot.truncated) {
    throw new ApiError(422, 'This comparison exceeds the available record window. Narrow the source documents.');
  }
  return comparePrescriptions(records, first, second);
}

export async function getMedicationDetails(userId: string, id: string) {
  const workspace = await getMedicationWorkspace(userId);
  const medication = workspace.medications.find((row) => row.id === id);
  if (!medication) throw notFound('Medication not found');
  return {
    medication: { ...medication, effectiveStatus: medicationStatus(medication) },
    audit: workspace.audit.filter((entry) => entry.medicationId === id ||
      workspace.findings.some((finding) => finding.id === entry.findingId && finding.medicationIds.includes(id))),
    events: workspace.events.filter((event) => event.medicationIds.includes(id)),
    findings: workspace.findings.filter((finding) => finding.medicationIds.includes(id)),
  };
}

export function isCurrentMedicationStatus(status: ReturnType<typeof medicationStatus>): boolean {
  return ['confirmed_current', 'prescribed_unconfirmed', 'unknown'].includes(status);
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    pagination: { page, pageSize, total: items.length, hasMore: offset + pageSize < items.length },
  };
}
