import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  HAS_DATABASE, USER_A, USER_B, db, tables, seedUsers, seedDocument, cleanup,
} from '@/test/route-harness';
import {
  getMedicationSnapshot, getMedicationDocument, synchronizeMedicationObservations,
  updateMedicationRecord, saveSafetyEvaluation, reviewMedicationFinding,
  applyMedicationFindingReviews,
} from './repository';
import type { PreparedMedicationRow } from './observations';
import type { SafetyFinding } from './types';

const suite = describe.skipIf(!HAS_DATABASE);

function sourceRow(userId: string, documentId: string, dosage = '500 mg'): PreparedMedicationRow {
  return {
    userId, documentId, name: 'Synthetic metformin', genericName: null, dosage,
    frequency: 'daily', duration: null, route: 'oral', rxnormId: null,
    isActive: true, prescribedDate: null, sourceKey: 'synthetic-source-key', sourceActive: true,
    updatedAt: new Date(),
    observation: {
      originalName: 'Synthetic metformin', excerpt: `Synthetic metformin ${dosage} daily`,
      status: 'prescribed_unconfirmed', confidence: 'documented',
    },
  };
}

async function ingest(userId: string, documentId: string, rows: PreparedMedicationRow[]) {
  await db.transaction((tx) => synchronizeMedicationObservations(tx, userId, documentId, rows));
}

async function exampleFinding(userId: string): Promise<{ finding: SafetyFinding; revision: string }> {
  const snapshot = await getMedicationSnapshot(userId);
  const medication = snapshot.medications[0];
  return {
    revision: snapshot.revision,
    finding: {
      id: 'synthetic-stable-finding', userId, category: 'missing_information',
      medicationIds: [medication.id], title: 'Verify dose', explanation: 'Synthetic documentation question.',
      certainty: 'uncertain', severity: null, knowledgeSource: null,
      detectedAt: new Date().toISOString(), reviewStatus: 'open', resolutionNotes: null, current: true,
      evidence: [{
        medicationId: medication.id, documentId: medication.documentId, documentTitle: medication.documentTitle,
        documentDate: null, page: null, excerpt: medication.observation.excerpt ?? null, kind: 'document',
      }],
    },
  };
}

suite('medication repository on the explicitly isolated test database', () => {
  beforeEach(seedUsers);
  afterEach(cleanup);

  it('is idempotent under concurrent ingestion and preserves corrections on reprocessing', async () => {
    const documentId = await seedDocument(USER_A);
    const row = sourceRow(USER_A, documentId);
    await Promise.all([ingest(USER_A, documentId, [row]), ingest(USER_A, documentId, [row])]);
    const initial = await getMedicationSnapshot(USER_A);
    expect(initial.medications).toHaveLength(1);
    expect(initial.audit.filter((entry) => entry.action === 'source_observation_updated')).toHaveLength(0);
    const id = initial.medications[0].id;
    await updateMedicationRecord(USER_A, id, {
      status: 'confirmed_current', corrections: { dosage: 'Patient-reported 850 mg' }, note: 'Synthetic patient confirmation',
    });
    await ingest(USER_A, documentId, [sourceRow(USER_A, documentId, '1000 mg')]);
    const after = await getMedicationSnapshot(USER_A);
    expect(after.medications).toHaveLength(1);
    expect(after.medications[0]).toMatchObject({
      id, dosage: '1000 mg', patientStatus: 'confirmed_current', corrections: { dosage: 'Patient-reported 850 mg' },
    });
    expect(after.audit.some((entry) => entry.action === 'source_observation_updated' && entry.before?.dosage === '500 mg')).toBe(true);
  });

  it('archives missing source observations without inventing clinical discontinuation', async () => {
    const documentId = await seedDocument(USER_A);
    await ingest(USER_A, documentId, [sourceRow(USER_A, documentId)]);
    const first = (await getMedicationSnapshot(USER_A)).medications[0];
    await updateMedicationRecord(USER_A, first.id, { status: 'confirmed_current', note: 'Synthetic confirmation' });
    await ingest(USER_A, documentId, []);
    const archived = (await getMedicationSnapshot(USER_A)).medications[0];
    expect(archived).toMatchObject({ id: first.id, sourceActive: false, patientStatus: 'confirmed_current' });
    expect(archived.observation.status).toBe('prescribed_unconfirmed');
  });

  it('enforces tenant ownership in reads, corrections, ingestion and the composite foreign key', async () => {
    const documentId = await seedDocument(USER_A);
    await ingest(USER_A, documentId, [sourceRow(USER_A, documentId)]);
    const id = (await getMedicationSnapshot(USER_A)).medications[0].id;
    expect((await getMedicationSnapshot(USER_B)).medications).toEqual([]);
    await expect(getMedicationDocument(USER_B, documentId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateMedicationRecord(USER_B, id, { status: 'historical', note: 'Unauthorized synthetic attempt' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(ingest(USER_B, documentId, [sourceRow(USER_B, documentId)])).rejects.toMatchObject({ statusCode: 404 });
    await expect(db.insert(tables.medications).values(sourceRow(USER_B, documentId))).rejects.toThrow();
    expect((await getMedicationSnapshot(USER_B)).audit).toEqual([]);
  });

  it('rejects stale evaluations and source/profile changes invalidate current findings', async () => {
    const documentId = await seedDocument(USER_A);
    await ingest(USER_A, documentId, [sourceRow(USER_A, documentId)]);
    const { finding, revision } = await exampleFinding(USER_A);
    expect(await saveSafetyEvaluation(USER_A, { findings: [finding], snapshotRevision: revision })).toBe(true);
    let snapshot = await getMedicationSnapshot(USER_A);
    expect(snapshot.findings[0].current).toBe(true);
    await db.update(tables.users).set({ knownAllergies: ['Synthetic allergy'] }).where(eq(tables.users.id, USER_A));
    snapshot = await getMedicationSnapshot(USER_A);
    expect(snapshot.findings[0].current).toBe(false);
    expect(await saveSafetyEvaluation(USER_A, { findings: [finding], snapshotRevision: revision })).toBe(false);
    await expect(reviewMedicationFinding(USER_A, snapshot.findings[0].id, { status: 'reviewed' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('preserves review history and requires a reason before resolving or dismissing', async () => {
    const documentId = await seedDocument(USER_A);
    await ingest(USER_A, documentId, [sourceRow(USER_A, documentId)]);
    const { finding, revision } = await exampleFinding(USER_A);
    await saveSafetyEvaluation(USER_A, { findings: [finding], snapshotRevision: revision });
    const saved = (await getMedicationSnapshot(USER_A)).findings[0];
    await expect(reviewMedicationFinding(USER_B, saved.id, { status: 'reviewed' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(reviewMedicationFinding(USER_A, saved.id, { status: 'dismissed' })).rejects.toMatchObject({ statusCode: 400 });
    await reviewMedicationFinding(USER_A, saved.id, { status: 'resolved', note: 'Discussed with synthetic clinician.' });
    expect((await applyMedicationFindingReviews(USER_A, [finding]))[0]).toMatchObject({
      id: saved.id, reviewStatus: 'resolved', resolutionNotes: 'Discussed with synthetic clinician.',
    });
    expect((await applyMedicationFindingReviews(USER_A, [{ ...finding, explanation: 'Different source meaning' }]))[0].reviewStatus).toBe('open');
    await expect(applyMedicationFindingReviews(USER_B, [finding])).rejects.toMatchObject({ statusCode: 400 });
    await saveSafetyEvaluation(USER_A, { findings: [finding], snapshotRevision: revision });
    let snapshot = await getMedicationSnapshot(USER_A);
    expect(snapshot.findings[0].reviewStatus).toBe('resolved');
    // PostgreSQL stores JSON object keys in its own order. Reversed nested key order
    // must be semantically identical and must not silently reopen a reviewed item.
    const reordered = {
      ...finding,
      evidence: finding.evidence.map((evidence) =>
        Object.fromEntries(Object.entries(evidence).reverse()) as unknown as typeof evidence),
    };
    await saveSafetyEvaluation(USER_A, { findings: [reordered], snapshotRevision: revision });
    expect((await getMedicationSnapshot(USER_A)).findings[0].reviewStatus).toBe('resolved');
    expect(snapshot.audit.some((entry) => entry.action === 'finding_review')).toBe(true);
    await saveSafetyEvaluation(USER_A, {
      findings: [{ ...finding, explanation: 'Changed evidence requires another review.' }], snapshotRevision: revision,
    });
    snapshot = await getMedicationSnapshot(USER_A);
    expect(snapshot.findings[0]).toMatchObject({ id: saved.id, reviewStatus: 'open', resolutionNotes: null });
  });

  it('rolls back source replacement on failure and makes deleted-source findings stale', async () => {
    const documentId = await seedDocument(USER_A);
    await ingest(USER_A, documentId, [sourceRow(USER_A, documentId)]);
    await expect(db.transaction(async (tx) => {
      await synchronizeMedicationObservations(tx, USER_A, documentId, [sourceRow(USER_A, documentId, '850 mg')]);
      throw new Error('synthetic transaction failure');
    })).rejects.toThrow('synthetic transaction failure');
    expect((await getMedicationSnapshot(USER_A)).medications[0].dosage).toBe('500 mg');
    const { finding, revision } = await exampleFinding(USER_A);
    await saveSafetyEvaluation(USER_A, { findings: [finding], snapshotRevision: revision });
    await db.delete(tables.documents).where(eq(tables.documents.id, documentId));
    const snapshot = await getMedicationSnapshot(USER_A);
    expect(snapshot.medications).toEqual([]);
    expect(snapshot.findings[0].current).toBe(false);
  });

  it('does not rewrite unchanged findings or grow the audit on repeated evaluation', async () => {
    const documentId = await seedDocument(USER_A);
    await ingest(USER_A, documentId, [sourceRow(USER_A, documentId)]);
    const { finding, revision } = await exampleFinding(USER_A);
    await saveSafetyEvaluation(USER_A, { findings: [finding], snapshotRevision: revision });
    const snapshot = await getMedicationSnapshot(USER_A);
    const savedId = snapshot.findings[0].id;
    const marker = new Date('2020-01-01T00:00:00.000Z');
    // A fixed old marker makes the regression deterministic without timing sleeps.
    await db.update(tables.medicationFindings).set({
      updatedAt: marker, lastEvaluatedAt: marker,
    }).where(eq(tables.medicationFindings.id, savedId));

    await saveSafetyEvaluation(USER_A, { findings: [finding], snapshotRevision: revision });
    const [unchanged] = await db.select().from(tables.medicationFindings)
      .where(eq(tables.medicationFindings.id, savedId));
    expect(unchanged.updatedAt).toEqual(marker);
    expect(unchanged.lastEvaluatedAt).toEqual(marker);
    expect((await getMedicationSnapshot(USER_A)).audit).toEqual(snapshot.audit);
  });
});
