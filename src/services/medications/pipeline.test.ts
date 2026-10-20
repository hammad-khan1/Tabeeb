import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  HAS_DATABASE, USER_A, USER_B, db, tables, seedUsers, seedDocument, cleanup,
} from '@/test/route-harness';
import { applyConfirmedExtraction, processDocument } from '@/services/document-processor';
import { getMedicationSnapshot } from './repository';

const external = vi.hoisted(() => ({
  extractText: vi.fn(),
  extractEntities: vi.fn(),
  completion: vi.fn(),
  normalize: vi.fn(),
  embedBatch: vi.fn(),
  summary: vi.fn(),
}));
vi.mock('@/services/text-extractors', () => ({ extractText: external.extractText }));
vi.mock('@/services/nlp/medical-ner', () => ({ extractMedicalEntities: external.extractEntities }));
vi.mock('@/lib/groq', () => ({
  getGroq: () => ({ chat: { completions: { create: external.completion } } }),
  MODELS: { primary: 'synthetic-extraction-model', fast: 'synthetic-fast-model' },
}));
vi.mock('@/services/medications/normalization', () => ({ normalizeMedicationIdentity: external.normalize }));
vi.mock('@/lib/embeddings', () => ({ embeddingProvider: { embedBatch: external.embedBatch } }));
vi.mock('@/services/summarizer', () => ({ generateDocumentSummary: external.summary }));

const SOURCE = 'Synthetic clinic\n2026-01-01\nMedications\nMetformin 500 mg one tablet daily oral';
const EXTRACTED = {
  medications: [{
    name: 'Metformin', dosage: '500 mg', strength: '500', unit: 'mg',
    form: 'tablet', doseAmount: 'one tablet', frequency: 'daily', route: 'oral',
    excerpt: 'Metformin 500 mg one tablet daily oral',
  }],
  diagnoses: [], labResults: [], allergies: [],
  documentDate: '2026-01-01', language: 'en',
};

async function storedDocument(documentId: string) {
  const [row] = await db.select().from(tables.documents).where(and(
    eq(tables.documents.id, documentId), eq(tables.documents.userId, USER_A)
  ));
  return row;
}
async function storedChunks(documentId: string) {
  return db.select().from(tables.documentChunks).where(and(
    eq(tables.documentChunks.documentId, documentId), eq(tables.documentChunks.userId, USER_A)
  )).orderBy(tables.documentChunks.chunkIndex);
}

describe.skipIf(!HAS_DATABASE)('synthetic medication ingestion and confirmation pipeline', () => {
  beforeEach(async () => {
    for (const mock of Object.values(external)) mock.mockReset();
    external.extractText.mockResolvedValue({ text: SOURCE, confidence: 95, isHandwritten: false, isScanned: false });
    external.extractEntities.mockResolvedValue([]);
    external.completion.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(EXTRACTED) } }] });
    external.normalize.mockResolvedValue({
      status: 'verified', normalizedName: 'metformin', rxcui: '6809', conceptType: 'IN',
      ingredients: [{ rxcui: '6809', name: 'metformin' }],
      provider: 'RxNorm', version: 'synthetic-test-version', checkedAt: '2026-01-01T00:00:00.000Z',
      limitations: [],
    });
    external.embedBatch.mockImplementation(async (texts: string[]) => texts.map(() => Array.from({ length: 1024 }, () => 0)));
    external.summary.mockResolvedValue('Synthetic summary of the original prescription.');
    await seedUsers();
  });
  afterEach(cleanup);

  it('processes the source into verified observations and chunks, with stable medication identity on retry', async () => {
    const documentId = await seedDocument(USER_A, { documentType: 'prescription', extractionStatus: 'pending' });
    await processDocument(documentId, USER_A);
    const first = (await getMedicationSnapshot(USER_A)).medications;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      name: 'Metformin', dosage: '500 mg', patientStatus: null,
      observation: {
        originalName: 'Metformin', status: 'prescribed_unconfirmed',
        excerpt: 'Metformin 500 mg one tablet daily oral',
        normalization: { status: 'verified', rxcui: '6809' },
      },
    });
    expect(first[0].observation.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await storedDocument(documentId)).extractionStatus).toBe('confirmed');
    const chunks = await storedChunks(documentId);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((row) => row.content).join('\n')).toContain('Metformin 500 mg');
    expect(chunks.every((row) => row.embedding?.length === 1024)).toBe(true);

    await processDocument(documentId, USER_A);
    const retried = (await getMedicationSnapshot(USER_A)).medications;
    expect(retried).toHaveLength(1);
    expect(retried[0].id).toBe(first[0].id);
    expect((await storedChunks(documentId)).map((row) => row.content)).toEqual(chunks.map((row) => row.content));
    expect(external.extractText).toHaveBeenCalledTimes(2);
  });

  it('stores confirmation corrections separately from original medication evidence and structured data', async () => {
    const documentId = await seedDocument(USER_A, { documentType: 'prescription', extractionStatus: 'pending' });
    await processDocument(documentId, USER_A);
    const before = (await getMedicationSnapshot(USER_A)).medications[0];
    await applyConfirmedExtraction(documentId, USER_A, {
      structuredData: {
        ...EXTRACTED,
        medications: [{ ...EXTRACTED.medications[0], dosage: '850 mg', frequency: 'twice daily' }],
      },
    });
    const snapshot = await getMedicationSnapshot(USER_A);
    expect(snapshot.medications[0]).toMatchObject({
      id: before.id, dosage: '500 mg', frequency: 'daily',
      patientStatus: null, // Reviewing OCR does not establish current medication use.
      corrections: { dosage: '850 mg', frequency: 'twice daily' },
      observation: before.observation,
    });
    const source = await storedDocument(documentId);
    expect(source.structuredData).toMatchObject({
      medications: [{ dosage: '500 mg', frequency: 'daily' }],
    });
    expect(source.rawExtractedText).toBe(SOURCE);
    expect(snapshot.audit.some((entry) => entry.action === 'patient_correction' && entry.medicationId === before.id)).toBe(true);
  });

  it('keeps source, status, medication observations and chunks unchanged when confirmation embedding fails', async () => {
    const documentId = await seedDocument(USER_A, { documentType: 'prescription', extractionStatus: 'pending' });
    await processDocument(documentId, USER_A);
    await db.update(tables.documents).set({
      extractionStatus: 'needs_review', extractionNotes: 'Synthetic pending review',
    }).where(and(eq(tables.documents.id, documentId), eq(tables.documents.userId, USER_A)));
    const beforeDocument = await storedDocument(documentId);
    const beforeMedication = (await getMedicationSnapshot(USER_A)).medications;
    const beforeChunks = await storedChunks(documentId);
    external.embedBatch.mockRejectedValueOnce(new Error('Synthetic embedding outage'));

    await expect(applyConfirmedExtraction(documentId, USER_A, {
      correctedText: `${SOURCE}\nSynthetic patient clarification`,
      structuredData: {
        ...EXTRACTED, medications: [{ ...EXTRACTED.medications[0], dosage: '850 mg' }],
      },
    })).rejects.toThrow('Synthetic embedding outage');
    expect(await storedDocument(documentId)).toEqual(beforeDocument);
    expect((await getMedicationSnapshot(USER_A)).medications).toEqual(beforeMedication);
    expect(await storedChunks(documentId)).toEqual(beforeChunks);
  });

  it('rejects another patient before extraction or external calls', async () => {
    const documentId = await seedDocument(USER_A, { documentType: 'prescription', extractionStatus: 'pending' });
    await expect(processDocument(documentId, USER_B)).rejects.toMatchObject({ statusCode: 404 });
    await expect(applyConfirmedExtraction(documentId, USER_B)).rejects.toMatchObject({ statusCode: 404 });
    expect(external.extractText).not.toHaveBeenCalled();
    expect(external.completion).not.toHaveBeenCalled();
    expect(external.normalize).not.toHaveBeenCalled();
    expect(external.embedBatch).not.toHaveBeenCalled();
  });

  it('retains established allergies, diagnoses and labs during low-confidence reprocessing', async () => {
    const documentId = await seedDocument(USER_A, { documentType: 'prescription', extractionStatus: 'pending' });
    external.extractText.mockResolvedValueOnce({
      text: `${SOURCE}\nAllergies\nPenicillin rash\nDiagnosis\nHypertension\nLab Results\nHemoglobin 12 g/dL`,
      confidence: 95,
    });
    external.completion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        ...EXTRACTED,
        allergies: [{ allergen: 'Penicillin', reaction: 'rash' }],
        diagnoses: [{ condition: 'Hypertension' }],
        labResults: [{ testName: 'Hemoglobin', value: '12', unit: 'g/dL', testDate: '2026-01-01' }],
      }) } }],
    });
    await processDocument(documentId, USER_A);
    const originalAllergies = await db.select().from(tables.allergies).where(eq(tables.allergies.documentId, documentId));
    const originalDiagnoses = await db.select().from(tables.diagnoses).where(eq(tables.diagnoses.documentId, documentId));
    const originalLabs = await db.select().from(tables.labResults).where(eq(tables.labResults.documentId, documentId));
    expect(originalAllergies).toHaveLength(1);
    expect(originalDiagnoses).toHaveLength(1);
    expect(originalLabs).toHaveLength(1);

    // An unreliable second reading misses the other findings entirely.
    external.extractText.mockResolvedValueOnce({ text: SOURCE, confidence: 20 });
    await processDocument(documentId, USER_A);
    expect((await storedDocument(documentId)).extractionStatus).toBe('needs_review');
    expect(await db.select().from(tables.allergies).where(eq(tables.allergies.documentId, documentId))).toEqual(originalAllergies);
    expect(await db.select().from(tables.diagnoses).where(eq(tables.diagnoses.documentId, documentId))).toEqual(originalDiagnoses);
    expect(await db.select().from(tables.labResults).where(eq(tables.labResults.documentId, documentId))).toEqual(originalLabs);
    expect((await getMedicationSnapshot(USER_A)).allergies.some((allergy) => allergy.allergen === 'Penicillin')).toBe(true);
  });

  it('treats reordered same-name strengths as unchanged and rejects ambiguous edits before writing', async () => {
    const documentId = await seedDocument(USER_A, { documentType: 'prescription', extractionStatus: 'pending' });
    const source = `${SOURCE}\nMetformin 1000 mg one tablet daily oral`;
    const extracted = {
      ...EXTRACTED,
      medications: [
        EXTRACTED.medications[0],
        { ...EXTRACTED.medications[0], dosage: '1000 mg', strength: '1000', excerpt: 'Metformin 1000 mg one tablet daily oral' },
      ],
    };
    external.extractText.mockResolvedValue({ text: source, confidence: 95 });
    external.completion.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(extracted) } }] });
    await processDocument(documentId, USER_A);
    const original = (await getMedicationSnapshot(USER_A)).medications;
    await applyConfirmedExtraction(documentId, USER_A, {
      structuredData: { ...extracted, medications: [...extracted.medications].reverse() },
    });
    const afterReorder = (await getMedicationSnapshot(USER_A)).medications;
    expect(afterReorder.map((row) => ({ id: row.id, dosage: row.dosage, corrections: row.corrections })))
      .toEqual(original.map((row) => ({ id: row.id, dosage: row.dosage, corrections: row.corrections })));

    const beforeDocument = await storedDocument(documentId);
    const embeddingsBefore = external.embedBatch.mock.calls.length;
    await expect(applyConfirmedExtraction(documentId, USER_A, {
      structuredData: {
        ...extracted,
        medications: [
          { ...extracted.medications[0], dosage: '850 mg' },
          { ...extracted.medications[1], dosage: '1500 mg' },
        ],
      },
    })).rejects.toThrow('Correct each medication separately in the medication dashboard');
    expect(await storedDocument(documentId)).toEqual(beforeDocument);
    expect((await getMedicationSnapshot(USER_A)).medications).toEqual(afterReorder);
    expect(external.embedBatch).toHaveBeenCalledTimes(embeddingsBefore);
  });
});
