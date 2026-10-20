import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  HAS_DATABASE, USER_A, USER_B, actAs, seedUsers, seedDocument, cleanup,
  db, tables, nextRequest, jsonRequest, params,
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { structuredExtractionSchema } from '@/services/extraction-schema';
import { prepareMedicationRows } from '@/services/medications/observations';
import { synchronizeMedicationObservations, lockMedicationOwner } from '@/services/medications/repository';
import { GET as list } from './route';
import { GET as detail } from './[id]/route';
import { POST as confirm } from './[id]/confirmation/route';
import { GET as findings } from './findings/route';
import { POST as review } from './findings/[id]/review/route';
import { GET as timeline } from './timeline/route';
import { GET as compare } from './compare/route';
import { GET as sourceFile } from '@/app/api/documents/[id]/file/route';
import { generatePatientBriefing } from '@/services/briefing/briefing-generator';
import { generateBriefingPdf } from '@/services/briefing/pdf-generator';
import { createBriefingShareLink, getSharedBriefing, revokeBriefingShareLink } from '@/services/briefing/share';
import { GET as sharedFile } from '@/app/api/briefing/share/[token]/documents/[id]/file/route';

vi.mock('@/services/medications/normalization', () => ({
  normalizeMedicationIdentity: vi.fn(async () => ({
    status: 'verified', normalizedName: 'amoxicillin', rxcui: '723',
    conceptType: 'IN', ingredients: [{ rxcui: '723', name: 'amoxicillin' }],
    provider: 'RxNorm', version: 'synthetic-test', checkedAt: '2026-01-01T00:00:00.000Z', limitations: [],
  })),
}));

const describeDb = HAS_DATABASE ? describe : describe.skip;
describeDb('Medication workflow and briefing integration on isolated PostgreSQL', { timeout: 30000 }, () => {
  let first: string;
  let second: string;
  let foreign: string;
  let medicationId: string;

  beforeEach(async () => {
    await cleanup();
    await seedUsers();
    resetRateLimits();
    actAs(USER_A);
    first = await seedDocument(USER_A, { title: 'Synthetic first prescription', documentType: 'prescription' });
    second = await seedDocument(USER_A, { title: 'Synthetic second prescription', documentType: 'prescription' });
    foreign = await seedDocument(USER_B, { title: 'Withheld source', documentType: 'prescription' });
    for (const [documentId, frequency, date] of [
      [first, 'three times daily', '2026-01-01'],
      [second, 'twice daily', '2026-02-01'],
    ]) {
      const excerpt = `Amoxicillin 500 mg ${frequency} for five days orally`;
      await db.update(tables.documents).set({ documentDate: new Date(date), rawExtractedText: excerpt })
        .where(eq(tables.documents.id, documentId));
      const data = structuredExtractionSchema.parse({
        medications: [{ name: 'Amoxicillin', dosage: '500 mg', strength: '500', unit: 'mg',
          doseAmount: 'one capsule', frequency, duration: 'five days', route: 'oral', excerpt, instructions: excerpt }],
      });
      const rows = await prepareMedicationRows({
        documentId, userId: USER_A, data, text: excerpt, documentDate: new Date(date), lowConfidence: false,
      });
      await db.transaction(async (tx) => {
        await lockMedicationOwner(tx, USER_A);
        await synchronizeMedicationObservations(tx, USER_A, documentId, rows);
      });
    }
    await db.insert(tables.allergies).values({
      userId: USER_A, documentId: first, allergen: 'amoxicillin', reaction: 'Synthetic documented rash',
    });
    const [row] = await db.select().from(tables.medications).where(eq(tables.medications.documentId, first));
    medicationId = row.id;
  });
  afterAll(cleanup);

  it('extracts evidence-linked registry records, paginates, reconciles and generates a readable briefing PDF', async () => {
    const response = await list(nextRequest('http://localhost/api/medications?pageSize=1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    const body = await response.json();
    expect(body.medications).toHaveLength(1);
    expect(body.counts.prescribed_unconfirmed).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.interactionCheck.status).toBe('unavailable');
    expect(body.medications[0].observation.excerpt).toContain('Amoxicillin');
    const checks = await (await findings(nextRequest('http://localhost/api/medications/findings'))).json();
    expect(checks.findings.map((row: { category: string }) => row.category))
      .toEqual(expect.arrayContaining(['allergy_concern', 'ingredient_duplication', 'reconciliation_difference']));
    expect(checks.findings.some((row: { category: string }) => row.category === 'drug_interaction')).toBe(false);
    const changes = await (await timeline(nextRequest('http://localhost/api/medications/timeline'))).json();
    expect(changes.events.some((row: { type: string }) => row.type === 'frequency_change')).toBe(true);
    const compared = await (await compare(nextRequest(`http://localhost/api/medications/compare?left=${first}&right=${second}`))).json();
    expect(compared.differences.some((row: { field: string }) => row.field === 'frequency')).toBe(true);
    const briefing = await generatePatientBriefing(USER_A);
    expect(briefing.currentMedications.every((row) => row.useStatus === 'prescribed_unconfirmed')).toBe(true);
    expect(briefing.medicationSafety?.interactionCoverage.status).toBe('unavailable');
    expect(briefing.treatmentConflicts).toEqual([]);
    const pdf = generateBriefingPdf(briefing).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.includes('MEDICATION SAFETY & RECONCILIATION')).toBe(true);
    expect(pdf).toContain('unavailable');
    expect(pdf).toContain('%%EOF');
  });

  it('preserves original evidence after corrections and carries patient confirmation into the briefing', async () => {
    const [before] = await db.select().from(tables.medications).where(eq(tables.medications.id, medicationId));
    const response = await confirm(jsonRequest('http://localhost/api/medications/x/confirmation', 'POST', {
      status: 'confirmed_current', corrections: { frequency: 'Patient says once daily' }, note: 'Synthetic patient confirmation',
    }), params({ id: medicationId }));
    expect(response.status).toBe(200);
    const [after] = await db.select().from(tables.medications).where(eq(tables.medications.id, medicationId));
    expect(after.observation).toEqual(before.observation);
    expect(after.frequency).toBe(before.frequency);
    expect(after.corrections?.frequency).toBe('Patient says once daily');
    const details = await (await detail(nextRequest('http://localhost/api/medications/x'), params({ id: medicationId }))).json();
    expect(details.audit.some((entry: { action: string }) => entry.action === 'patient_correction')).toBe(true);
    const briefing = await generatePatientBriefing(USER_A);
    expect(briefing.currentMedications.find((row) => row.id === medicationId)?.useStatus).toBe('confirmed_current');
    expect(briefing.currentMedications.find((row) => row.id === medicationId)?.frequency).toBe(before.frequency);
  });

  it('keeps unknown clinical dates separate from source upload timestamps', async () => {
    await db.update(tables.documents).set({ documentDate: null }).where(eq(tables.documents.id, first));
    const consultation = await seedDocument(USER_A, { documentType: 'consultation_note' });
    const briefing = await generatePatientBriefing(USER_A);
    expect(briefing.doctorTimeline.find((event) => event.sourceDocumentId === first)?.date).toBeNull();
    expect(briefing.doctorTimeline.find((event) => event.sourceDocumentId === consultation)?.date).toBeNull();
    expect(briefing.consultationsAndPlans.find((plan) => plan.id === consultation)?.date).toBeNull();
    expect(generateBriefingPdf(briefing).toString('latin1')).toContain('Date unknown');
  });

  it('requires a reason for dismissal, persists reviews, and invalidates stale evidence', async () => {
    const body = await (await findings(nextRequest('http://localhost/api/medications/findings'))).json();
    const finding = body.findings.find((row: { category: string }) => row.category === 'allergy_concern');
    expect((await review(jsonRequest('http://localhost/review', 'POST', { status: 'dismissed' }), params({ id: finding.id }))).status).toBe(400);
    expect((await review(jsonRequest('http://localhost/review', 'POST', {
      status: 'reviewed', note: 'Discussed with a clinician in synthetic test',
    }), params({ id: finding.id }))).status).toBe(200);
    const again = await (await findings(nextRequest('http://localhost/api/medications/findings?status=reviewed'))).json();
    expect(again.findings.some((row: { id: string }) => row.id === finding.id)).toBe(true);
    await db.update(tables.allergies).set({ assertionStatus: 'absent' }).where(eq(tables.allergies.userId, USER_A));
    const fresh = await (await findings(nextRequest('http://localhost/api/medications/findings'))).json();
    expect(fresh.findings.some((row: { id: string }) => row.id === finding.id)).toBe(false);
    const [saved] = await db.select().from(tables.medicationFindings).where(eq(tables.medicationFindings.id, finding.id));
    expect(saved.active).toBe(false);
    expect(saved.reviewStatus).toBe('reviewed');
  });

  it('enforces cross-patient IDs, invalid IDs and browser payload boundaries', async () => {
    expect((await confirm(jsonRequest('http://localhost/confirmation', 'POST', {
      userId: USER_B, status: 'confirmed_current', note: 'spoof',
    }), params({ id: medicationId }))).status).toBe(400);
    expect((await detail(nextRequest('http://localhost/detail'), params({ id: 'bad-id' }))).status).toBe(400);
    expect((await compare(nextRequest(`http://localhost/compare?left=${first}&right=${foreign}`))).status).toBe(404);
    actAs(USER_B);
    expect((await detail(nextRequest('http://localhost/detail'), params({ id: medicationId }))).status).toBe(404);
    expect((await confirm(jsonRequest('http://localhost/confirmation', 'POST', {
      status: 'discontinued', note: 'spoof',
    }), params({ id: medicationId }))).status).toBe(404);
    expect((await sourceFile(nextRequest('http://localhost/source'), params({ id: first }))).status).toBe(404);
  });

  it('limits shared safety evidence to selected documents and withholds excluded sections and originals', async () => {
    const scoped = await createBriefingShareLink(USER_A, { documentIds: [first] });
    const shared = await getSharedBriefing(scoped.token);
    expect(JSON.stringify(shared)).not.toContain(second);
    expect(shared.briefing.medicationSafety?.findings.some((row) => row.category === 'reconciliation_difference')).toBe(false);
    const original = await sharedFile(nextRequest('http://localhost/source'), params({ token: scoped.token, id: first }));
    expect(original.status).toBe(200);
    expect((await sharedFile(nextRequest('http://localhost/source'), params({ token: scoped.token, id: second }))).status).toBe(404);
    const selected = await createBriefingShareLink(USER_A, { documentIds: [first], includedSections: ['summary', 'doctors'] });
    const restricted = await getSharedBriefing(selected.token);
    expect(restricted.briefing.medicationSafety).toBeNull();
    expect(JSON.stringify(restricted)).not.toContain('Amoxicillin');
    expect((await sharedFile(nextRequest('http://localhost/source'), params({ token: selected.token, id: first }))).status).toBe(404);
    await revokeBriefingShareLink(USER_A, scoped.token);
    await expect(getSharedBriefing(scoped.token)).rejects.toThrow();
    expect((await sharedFile(nextRequest('http://localhost/source'), params({ token: scoped.token, id: first }))).status).toBe(404);
    await db.update(tables.briefingShareLinks).set({ expiresAt: new Date('2000-01-01') }).where(eq(tables.briefingShareLinks.token, selected.token));
    await expect(getSharedBriefing(selected.token)).rejects.toThrow();
  });

  it('honors an explicit empty briefing scope and date-scoped source access', async () => {
    const empty = await generatePatientBriefing(USER_A, { documentIds: [] });
    expect(empty.documentCount).toBe(0);
    const link = await createBriefingShareLink(USER_A, { dateRangeFrom: '2026-01-15' });
    expect((await sharedFile(nextRequest('http://localhost/source'), params({ token: link.token, id: first }))).status).toBe(404);
    expect((await sharedFile(nextRequest('http://localhost/source'), params({ token: link.token, id: second }))).status).toBe(200);
  });

  it('does not repeat withheld clinical text through conflict explanations or medication corrections', async () => {
    const [row] = await db.select().from(tables.medications).where(eq(tables.medications.id, medicationId));
    await db.update(tables.medications).set({
      observation: { ...row.observation, instructions: 'Amoxicillin for ConfidentialDiagnosisZ; review privately.' },
      corrections: { frequency: 'Patient private note ConfidentialDiagnosisZ' },
    }).where(eq(tables.medications.id, medicationId));
    const link = await createBriefingShareLink(USER_A, { documentIds: [first, second], includedSections: ['medications', 'conflicts'] });
    const shared = await getSharedBriefing(link.token);
    expect(shared.briefing.currentMedications.length).toBe(2);
    expect(shared.briefing.medicationSafety?.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(shared)).not.toContain('ConfidentialDiagnosisZ');
    expect(shared.briefing.currentMedications[0].patientCorrections).toEqual({});
    expect(shared.originalDocumentsAvailable).toBe(false);
  });
});
