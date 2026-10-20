import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/lib/db';
import { badRequest, notFound } from '@/lib/api-error';
import {
  medications, documents, allergies, users, medicationFindings, medicationAudit,
} from '../../../drizzle/schema';
import {
  MEDICATION_STATUSES,
  type MedicationRecord, type MedicationObservation, type MedicationCorrections,
  type MedicationSnapshot, type MedicationStatus, type SafetyFinding, type FindingReviewStatus,
} from './types';
import type { PreparedMedicationRow } from './observations';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Database | Transaction;
const SNAPSHOT_LIMIT = 2000;
const REVIEW_STATUSES: FindingReviewStatus[] = ['open', 'needs_verification', 'reviewed', 'resolved', 'dismissed'];
const CORRECTION_FIELDS = ['name', 'dosage', 'frequency', 'duration', 'route', 'strength', 'doseAmount', 'instructions'] as const;

export interface MedicationDocument {
  id: string;
  title: string;
  documentDate: string | null;
  documentType: string;
}
export interface MedicationAuditEntry {
  id: string;
  medicationId: string | null;
  findingId: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
}
export interface OwnedMedicationSnapshot extends MedicationSnapshot {
  documents: MedicationDocument[];
  audit: MedicationAuditEntry[];
  revision: string;
  truncated: boolean;
}

/** Serializes ingestion, evaluation, and patient decisions for one owner. */
export async function lockMedicationOwner(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`medications:${userId}`}, 0))`);
}

function validStatus(value: string | null): MedicationStatus | null {
  return MEDICATION_STATUSES.includes(value as MedicationStatus) ? value as MedicationStatus : null;
}

/** Conservative adapter for rows written before the safety engine existed. */
export function medicationRecordFromRow(
  row: typeof medications.$inferSelect,
  document: MedicationDocument
): MedicationRecord {
  const observation = (row.observation ?? {}) as MedicationObservation;
  return {
    id: row.id, userId: row.userId, documentId: row.documentId,
    documentTitle: document.title, documentType: document.documentType,
    documentDate: document.documentDate,
    createdAt: row.createdAt?.toISOString() ?? '',
    updatedAt: row.updatedAt.toISOString(),
    name: row.name, genericName: row.genericName,
    dosage: row.dosage, frequency: row.frequency, duration: row.duration, route: row.route,
    // Legacy model-generated RxCUIs are never treated as verified.
    rxnormId: observation.normalization?.status === 'verified' ? observation.normalization.rxcui : null,
    observation: row.observation ? observation : {
      originalName: row.name,
      status: 'unknown',
      confidence: 'unverified',
      normalization: {
        status: 'unresolved', normalizedName: null, rxcui: null, conceptType: null,
        ingredients: [], provider: null, version: null, checkedAt: null,
        limitations: ['Legacy extraction has not been verified against RxNorm. Confirm the source and current use.'],
      },
    },
    patientStatus: validStatus(row.patientStatus),
    corrections: (row.corrections ?? {}) as MedicationCorrections,
    sourceActive: row.sourceActive,
    sourceKey: row.sourceKey,
  };
}

function asFinding(row: typeof medicationFindings.$inferSelect): SafetyFinding {
  return {
    ...row.payload as unknown as SafetyFinding,
    id: row.id, userId: row.userId, current: row.active,
    reviewStatus: row.reviewStatus as FindingReviewStatus,
    resolutionNotes: row.resolutionNote,
    detectedAt: row.detectedAt.toISOString(),
  };
}

async function snapshot(db: Reader, userId: string): Promise<OwnedMedicationSnapshot> {
  const [medicationRows, documentRows, allergyRows, findingRows, auditRows, profiles] = await Promise.all([
    db.select({
      medication: medications,
      document: {
        id: documents.id, title: documents.title,
        documentDate: documents.documentDate, documentType: documents.documentType,
      },
    }).from(medications).innerJoin(documents, and(
      eq(documents.id, medications.documentId), eq(documents.userId, userId)
    )).where(eq(medications.userId, userId))
      .orderBy(desc(medications.sourceActive), desc(medications.createdAt), medications.id).limit(SNAPSHOT_LIMIT + 1),
    db.select({
      id: documents.id, title: documents.title,
      documentDate: documents.documentDate, documentType: documents.documentType,
    }).from(documents).where(eq(documents.userId, userId))
      .orderBy(desc(documents.documentDate), documents.id).limit(SNAPSHOT_LIMIT + 1),
    db.select({
      id: allergies.id, userId: allergies.userId, documentId: allergies.documentId,
      allergen: allergies.allergen, reaction: allergies.reaction, severity: allergies.severity,
      assertionStatus: allergies.assertionStatus, documentTitle: documents.title,
      owner: documents.userId,
    }).from(allergies).leftJoin(documents, eq(allergies.documentId, documents.id))
      .where(eq(allergies.userId, userId)).orderBy(allergies.id).limit(SNAPSHOT_LIMIT + 1),
    db.select().from(medicationFindings).where(eq(medicationFindings.userId, userId))
      .orderBy(desc(medicationFindings.active), desc(medicationFindings.detectedAt), medicationFindings.id).limit(SNAPSHOT_LIMIT + 1),
    db.select().from(medicationAudit).where(eq(medicationAudit.userId, userId))
      .orderBy(desc(medicationAudit.createdAt), medicationAudit.id).limit(SNAPSHOT_LIMIT + 1),
    db.select({ knownAllergies: users.knownAllergies }).from(users).where(eq(users.id, userId)).limit(1),
  ]);
  const documentList = documentRows.slice(0, SNAPSHOT_LIMIT).map((row) => ({
    ...row, documentDate: row.documentDate?.toISOString() ?? null,
  }));
  const records = medicationRows.slice(0, SNAPSHOT_LIMIT).map(({ medication, document }) =>
    medicationRecordFromRow(medication, { ...document, documentDate: document.documentDate?.toISOString() ?? null })
  );
  const ownedDocumentIds = new Set([...documentList.map((row) => row.id), ...records.map((row) => row.documentId)]);
  const activeMedicationIds = new Set(records.filter((row) => row.sourceActive).map((row) => row.id));
  const allergyList = allergyRows.slice(0, SNAPSHOT_LIMIT)
    .filter((row) => row.documentId === null || row.owner === userId)
    .map(({ owner: _owner, ...row }) => row);
  const profileAllergies = (profiles[0]?.knownAllergies ?? []).map((allergen, index) => ({
    id: `profile:${index}`, userId, documentId: null, documentTitle: null,
    allergen, reaction: null, severity: null, assertionStatus: 'present',
  }));
  const completeAllergies = [...allergyList, ...profileAllergies];
  const findings = findingRows.slice(0, SNAPSHOT_LIMIT).map(asFinding).map((finding) => ({
    ...finding,
    current: finding.current &&
      finding.medicationIds.every((id) => activeMedicationIds.has(id)) &&
      finding.evidence.every((evidence) => !evidence.documentId || ownedDocumentIds.has(evidence.documentId)),
  }));
  const truncated = [medicationRows, documentRows, allergyRows, findingRows, auditRows].some((rows) => rows.length > SNAPSHOT_LIMIT);
  // Excludes review metadata: a simultaneous review is preserved under the write lock.
  const revision = createHash('sha256').update(JSON.stringify({
    medications: records, allergies: completeAllergies, documents: documentList, truncated,
  })).digest('hex');
  return {
    medications: records, allergies: completeAllergies, findings, documents: documentList,
    audit: auditRows.slice(0, SNAPSHOT_LIMIT).map((row) => ({
      id: row.id, medicationId: row.medicationId, findingId: row.findingId,
      action: row.action, before: row.before, after: row.after, note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    revision, truncated,
    limitations: truncated ? [`This view is limited to ${SNAPSHOT_LIMIT} records per section. Findings cover only the records shown.`] : [],
  };
}

export async function getMedicationSnapshot(userId: string): Promise<OwnedMedicationSnapshot> {
  return snapshot(getDb(), userId);
}

export async function getMedicationDocument(userId: string, id: string): Promise<MedicationDocument> {
  const [row] = await getDb().select({
    id: documents.id, title: documents.title, documentDate: documents.documentDate,
    documentType: documents.documentType,
  }).from(documents).where(and(eq(documents.id, id), eq(documents.userId, userId))).limit(1);
  if (!row) throw notFound('Document not found');
  return { ...row, documentDate: row.documentDate?.toISOString() ?? null };
}

export async function invalidateMedicationFindings(tx: Transaction, userId: string, reason: string): Promise<void> {
  const rows = await tx.update(medicationFindings)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(medicationFindings.userId, userId), eq(medicationFindings.active, true)))
    .returning({ id: medicationFindings.id });
  if (rows.length) {
    await tx.insert(medicationAudit).values(rows.map((row) => ({
      userId, findingId: row.id, action: 'finding_invalidated', note: reason,
    })));
  }
}

/** Original rows are updated only by source processing; patient fields survive. */
export async function synchronizeMedicationObservations(
  tx: Transaction, userId: string, documentId: string, rows: PreparedMedicationRow[]
): Promise<void> {
  const [owner] = await tx.select({ id: documents.id }).from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId))).limit(1);
  if (!owner) throw notFound('Document not found');
  const previous = await tx.select().from(medications)
    .where(and(eq(medications.documentId, documentId), eq(medications.userId, userId)));
  const remaining = new Map(previous.map((row) => [row.id, row]));
  for (const row of rows) {
    const existing = previous.find((old) => old.sourceKey === row.sourceKey) ??
      previous.find((old) => old.sourceKey === null && remaining.has(old.id) && old.name === row.name);
    if (existing) {
      remaining.delete(existing.id);
      await tx.update(medications).set(row).where(and(eq(medications.id, existing.id), eq(medications.userId, userId)));
    } else {
      await tx.insert(medications).values(row);
    }
  }
  for (const row of remaining.values()) {
    if (!row.sourceActive) continue;
    await tx.update(medications).set({ sourceActive: false, isActive: false, updatedAt: new Date() })
      .where(and(eq(medications.id, row.id), eq(medications.userId, userId)));
    await tx.insert(medicationAudit).values({
      userId, medicationId: row.id, action: 'source_observation_archived',
      note: 'This observation was not reproduced on source reprocessing. No clinical discontinuation was inferred.',
    });
  }
  await invalidateMedicationFindings(tx, userId, 'Source extraction changed; a new safety evaluation is required.');
}

function findingMeaning(finding: SafetyFinding): string {
  return JSON.stringify({
    category: finding.category, medications: finding.medicationIds,
    title: finding.title, explanation: finding.explanation, certainty: finding.certainty,
    severity: finding.severity, evidence: finding.evidence,
    provider: finding.knowledgeSource?.provider, version: finding.knowledgeSource?.version,
  });
}

export async function saveSafetyEvaluation(
  userId: string, evaluation: { findings: SafetyFinding[]; snapshotRevision: string }
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    await lockMedicationOwner(tx, userId);
    const current = await snapshot(tx, userId);
    if (current.revision !== evaluation.snapshotRevision) return false;
    const medicationIds = new Set(current.medications.map((medication) => medication.id));
    if (evaluation.findings.some((finding) =>
      finding.userId !== userId || finding.medicationIds.some((id) => !medicationIds.has(id))
    )) throw badRequest('Invalid safety evaluation scope.');
    const previous = await tx.select().from(medicationFindings).where(eq(medicationFindings.userId, userId));
    const byKey = new Map(previous.map((row) => [row.findingKey, row]));
    const keys = new Set(evaluation.findings.map((finding) => finding.id));
    for (const finding of evaluation.findings) {
      const old = byKey.get(finding.id);
      const changed = old && findingMeaning(asFinding(old)) !== findingMeaning(finding);
      const values = {
        userId, findingKey: finding.id,
        payload: finding as unknown as Record<string, unknown>, active: true,
        lastEvaluatedAt: new Date(), updatedAt: new Date(),
        ...(!old || changed ? {
          reviewStatus: finding.reviewStatus, resolutionNote: null,
          detectedAt: new Date(finding.detectedAt),
        } : {}),
      };
      if (old) {
        await tx.update(medicationFindings).set(values)
          .where(and(eq(medicationFindings.id, old.id), eq(medicationFindings.userId, userId)));
        if (changed) await tx.insert(medicationAudit).values({
          userId, findingId: old.id, action: 'finding_reevaluated',
          before: old.payload, after: values.payload,
          note: 'Evidence changed; the finding requires review again.',
        });
      } else {
        const [inserted] = await tx.insert(medicationFindings).values(values).returning({ id: medicationFindings.id });
        await tx.insert(medicationAudit).values({ userId, findingId: inserted.id, action: 'finding_detected' });
      }
    }
    for (const old of previous) {
      if (!old.active || keys.has(old.findingKey)) continue;
      await tx.update(medicationFindings).set({ active: false, updatedAt: new Date(), lastEvaluatedAt: new Date() })
        .where(and(eq(medicationFindings.id, old.id), eq(medicationFindings.userId, userId)));
      await tx.insert(medicationAudit).values({
        userId, findingId: old.id, action: 'finding_retired',
        note: 'The finding is no longer supported by the evaluated source data.',
      });
    }
    return true;
  });
}

export interface MedicationUpdate {
  status?: MedicationStatus;
  corrections?: MedicationCorrections;
  note: string;
}

export async function updateMedicationRecord(userId: string, id: string, update: MedicationUpdate): Promise<MedicationRecord> {
  if (!update.note?.trim()) throw badRequest('Include a note explaining your update.');
  if (update.status !== undefined && !MEDICATION_STATUSES.includes(update.status)) throw badRequest('Invalid medication status.');
  if (update.corrections && Object.keys(update.corrections).some((key) => !CORRECTION_FIELDS.includes(key as typeof CORRECTION_FIELDS[number]))) {
    throw badRequest('Unsupported medication correction.');
  }
  await getDb().transaction(async (tx) => {
    await lockMedicationOwner(tx, userId);
    const [row] = await tx.select({ medication: medications }).from(medications)
      .innerJoin(documents, and(eq(documents.id, medications.documentId), eq(documents.userId, userId)))
      .where(and(eq(medications.id, id), eq(medications.userId, userId))).limit(1);
    if (!row) throw notFound('Medication not found');
    const before = { patientStatus: row.medication.patientStatus, corrections: row.medication.corrections };
    const after = {
      patientStatus: update.status ?? row.medication.patientStatus,
      corrections: { ...row.medication.corrections, ...update.corrections },
    };
    await tx.update(medications).set({ ...after, confirmedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(medications.id, id), eq(medications.userId, userId)));
    await tx.insert(medicationAudit).values({
      userId, medicationId: id,
      action: update.corrections ? 'patient_correction' : 'patient_confirmation',
      before, after, note: update.note.trim(),
    });
    await invalidateMedicationFindings(tx, userId, 'Patient information changed; a new safety evaluation is required.');
  });
  const result = (await getMedicationSnapshot(userId)).medications.find((row) => row.id === id);
  if (!result) throw notFound('Medication not found in the current view');
  return result;
}

export async function reviewMedicationFinding(
  userId: string, id: string, review: { status: FindingReviewStatus; note?: string }
): Promise<SafetyFinding> {
  if (!REVIEW_STATUSES.includes(review.status)) throw badRequest('Invalid review status.');
  if (['dismissed', 'resolved'].includes(review.status) && !review.note?.trim()) {
    throw badRequest('A reason is required to dismiss or resolve a finding.');
  }
  return getDb().transaction(async (tx) => {
    await lockMedicationOwner(tx, userId);
    const current = await snapshot(tx, userId);
    const finding = current.findings.find((row) => row.id === id);
    if (!finding) throw notFound('Finding not found');
    if (!finding.current) throw badRequest('This finding is stale. Refresh the safety evaluation before reviewing it.');
    const [updated] = await tx.update(medicationFindings).set({
      reviewStatus: review.status, resolutionNote: review.note?.trim() ?? null, updatedAt: new Date(),
    }).where(and(eq(medicationFindings.id, id), eq(medicationFindings.userId, userId))).returning();
    await tx.insert(medicationAudit).values({
      userId, findingId: id, action: 'finding_review',
      before: { reviewStatus: finding.reviewStatus, resolutionNotes: finding.resolutionNotes },
      after: { reviewStatus: review.status, resolutionNotes: review.note?.trim() ?? null },
      note: review.note?.trim() ?? null,
    });
    return asFinding(updated);
  });
}
