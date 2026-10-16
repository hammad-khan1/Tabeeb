import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  HAS_DATABASE,
  USER_A,
  USER_B,
  actAs,
  seedUsers,
  seedDocument,
  cleanup,
  db,
  tables,
  jsonRequest,
  nextRequest,
  params,
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';
import { GET as getBriefing } from './route';
import { POST as getPdf } from './pdf/route';
import { GET as listDoctors, POST as createDoctor } from './doctors/route';
import { PATCH as updateDoctor, DELETE as deleteDoctor } from './doctors/[id]/route';
import { GET as listShareLinks, POST as createShareLink } from './share/route';
import { POST as revokeShareLink } from './share/[token]/revoke/route';
import { GET as getSharedDocumentFile } from './share/[token]/documents/[id]/file/route';
import { getSharedBriefing } from '@/services/briefing/share';

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

describeIfDb('Doctor-Ready Patient Briefing API Routes', { timeout: 30000 }, () => {
  let docA1: string;
  let docA2: string;
  let docB1: string;

  beforeAll(async () => {
    await seedUsers();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    actAs(USER_A);

    // Seed document for User A with doctor information
    docA1 = await seedDocument(USER_A, {
      title: 'Cardiology Prescription Report',
      documentType: 'prescription',
    });
    // Update doctorName and hospital on docA1
    await db
      .update(tables.documents)
      .set({
        doctorName: 'Dr. Tariq Mahmood',
        hospital: 'National Hospital Lahore',
      })
      .where(eq(tables.documents.id, docA1));

    docA2 = await seedDocument(USER_A, {
      title: 'Lipid Profile Lab',
      documentType: 'lab_report',
    });
    await db
      .update(tables.documents)
      .set({
        doctorName: 'Dr. Tariq Mahmood',
        hospital: 'Chughtai Diagnostic Laboratories',
      })
      .where(eq(tables.documents.id, docA2));

    // Seed document for User B (tenant isolation check)
    docB1 = await seedDocument(USER_B, {
      title: 'User B Confidential Record',
      documentType: 'prescription',
    });
    await db
      .update(tables.documents)
      .set({
        doctorName: 'Dr. Confidential Person',
        hospital: 'Secret Clinic',
      })
      .where(eq(tables.documents.id, docB1));

    // Seed medications for User A
    await db.insert(tables.medications).values([
      {
        documentId: docA1,
        userId: USER_A,
        name: 'Atorvastatin',
        genericName: 'Atorvastatin Calcium',
        dosage: '20mg',
        frequency: 'once daily at night',
        isActive: true,
      },
      {
        documentId: docA1,
        userId: USER_A,
        name: 'Lisinopril',
        dosage: '10mg',
        frequency: 'once daily in morning',
        isActive: true,
      },
    ]);

    // Seed lab results for User A
    await db.insert(tables.labResults).values([
      {
        documentId: docA2,
        userId: USER_A,
        testName: 'Cholesterol Total',
        canonicalTestName: 'cholesterol_total',
        value: '220',
        numericValue: 220,
        unit: 'mg/dL',
        referenceRange: '< 200',
        isAbnormal: true,
        testDate: new Date('2025-01-15'),
      },
      {
        documentId: docA2,
        userId: USER_A,
        testName: 'Cholesterol Total',
        canonicalTestName: 'cholesterol_total',
        value: '185',
        numericValue: 185,
        unit: 'mg/dL',
        referenceRange: '< 200',
        isAbnormal: false,
        testDate: new Date('2025-04-15'),
      },
    ]);

    // Seed condition for User A
    await db.insert(tables.diagnoses).values([
      {
        documentId: docA1,
        userId: USER_A,
        condition: 'Essential Hypertension',
        icd10Code: 'I10',
        severity: 'Moderate',
      },
    ]);
  });

  it('GET /api/briefing returns structured briefing for authenticated patient', async () => {
    actAs(USER_A);
    const req = nextRequest('http://localhost:3000/api/briefing');
    const res = await getBriefing(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.patient.id).toBe(USER_A);
    expect(data.doctors.length).toBeGreaterThan(0);
    expect(data.currentMedications.length).toBe(2);
    expect(data.conditions.length).toBe(1);
    expect(data.labTrends.length).toBe(1);

    // Verify doctor attribution on prescription
    const atorvastatin = data.currentMedications.find((m: { name: string }) => m.name === 'Atorvastatin');
    expect(atorvastatin).toBeDefined();
    expect(atorvastatin.prescribingDoctor.name).toBe('Dr. Tariq Mahmood');
    expect(atorvastatin.prescribingDoctor.isIdentified).toBe(true);

    // Verify lab trend calculation across the two readings (220 -> 185)
    const lipidTrend = data.labTrends[0];
    expect(lipidTrend.testName).toBe('Cholesterol Total');
    expect(lipidTrend.latestValue).toBe('185');
    expect(lipidTrend.previousValue).toBe('220');
    expect(lipidTrend.direction).toBe('improved');
    expect(lipidTrend.latestIsAbnormal).toBe(false);
  });

  it('GET /api/briefing respects document scoping', async () => {
    actAs(USER_A);
    // Only request docA2 (the lab report)
    const req = nextRequest(`http://localhost:3000/api/briefing?documentIds=${docA2}`);
    const res = await getBriefing(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.isPartial).toBe(true);
    // Medications on docA1 must not be leaked when only docA2 is requested
    expect(data.currentMedications).toEqual([]);
    expect(data.labTrends.length).toBe(1);
  });

  it('does not leak User B data to User A', async () => {
    actAs(USER_A);
    const req = nextRequest('http://localhost:3000/api/briefing');
    const res = await getBriefing(req);
    const data = await res.json();

    const allDoctorNames = data.doctors.map((d: { name: string }) => d.name);
    expect(allDoctorNames).not.toContain('Dr. Confidential Person');
  });

  it('POST /api/briefing/pdf produces a downloadable binary PDF', async () => {
    actAs(USER_A);
    const req = jsonRequest('http://localhost:3000/api/briefing/pdf', 'POST', {});
    const res = await getPdf(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="tabeeb-patient-briefing.pdf"');

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    expect(buffer.toString('ascii').startsWith('%PDF-1.4')).toBe(true);
  });

  it('manages patient doctors via CRUD endpoints', async () => {
    actAs(USER_A);

    // 1. Create a doctor
    const createReq = jsonRequest('http://localhost:3000/api/briefing/doctors', 'POST', {
      name: 'Dr. Shahzad Anjum',
      specialty: 'Endocrinology',
      hospital: 'Doctors Hospital',
      contactInfo: '0300-1112233',
      notes: 'Consultation Room 5',
    });
    const createRes = await createDoctor(createReq);
    expect(createRes.status).toBe(201);
    const createdDoc = await createRes.json();
    expect(createdDoc.name).toBe('Dr. Shahzad Anjum');
    expect(createdDoc.sourceType).toBe('patient_entered');

    // 2. List doctors
    const listRes = await listDoctors();
    const doctorList = await listRes.json();
    const found = doctorList.find((d: { name: string }) => d.name === 'Dr. Shahzad Anjum');
    expect(found).toBeDefined();
    expect(found.specialty).toBe('Endocrinology');

    // 3. Update doctor
    const patchReq = jsonRequest(`http://localhost:3000/api/briefing/doctors/${createdDoc.id}`, 'PATCH', {
      specialty: 'Senior Diabetologist',
    });
    const patchRes = await updateDoctor(patchReq, params({ id: createdDoc.id }));
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.specialty).toBe('Senior Diabetologist');

    // 4. User B cannot update User A's doctor
    actAs(USER_B);
    const maliciousPatch = jsonRequest(`http://localhost:3000/api/briefing/doctors/${createdDoc.id}`, 'PATCH', {
      specialty: 'Hacked',
    });
    const maliciousRes = await updateDoctor(maliciousPatch, params({ id: createdDoc.id }));
    expect(maliciousRes.status).toBe(404);

    // 5. Delete doctor
    actAs(USER_A);
    const delReq = nextRequest(`http://localhost:3000/api/briefing/doctors/${createdDoc.id}`, { method: 'DELETE' });
    const delRes = await deleteDoctor(delReq, params({ id: createdDoc.id }));
    expect(delRes.status).toBe(200);
  });

  it('creates and verifies secure briefing share links with section permissions', async () => {
    actAs(USER_A);

    // Create share link with only summary and doctors sections
    const shareReq = jsonRequest('http://localhost:3000/api/briefing/share', 'POST', {
      title: 'Consultation Link for Dr. Khan',
      expiresInHours: 48,
      includedSections: ['summary', 'doctors'],
    });
    const shareRes = await createShareLink(shareReq);
    expect(shareRes.status).toBe(201);

    const shareData = await shareRes.json();
    expect(shareData.token).toBeDefined();
    expect(shareData.url).toContain(`/share/briefing/${shareData.token}`);

    // Read the shared briefing as a recipient
    const sharedResult = await getSharedBriefing(shareData.token);
    expect(sharedResult.title).toBe('Consultation Link for Dr. Khan');
    expect(sharedResult.viewCount).toBe(1);
    expect(sharedResult.briefing.doctors.length).toBeGreaterThan(0);
    // Medications were not in includedSections, so they should be withheld
    expect(sharedResult.briefing.currentMedications).toEqual([]);

    // List user share links
    const listRes = await listShareLinks();
    const links = await listRes.json();
    const matchingLink = links.find((l: { token: string }) => l.token === shareData.token);
    expect(matchingLink).toBeDefined();
    expect(matchingLink.isActive).toBe(true);

    // Revoke the link
    const revokeReq = nextRequest(`http://localhost:3000/api/briefing/share/${shareData.token}/revoke`, { method: 'POST' });
    const revokeRes = await revokeShareLink(revokeReq, params({ token: shareData.token }));
    expect(revokeRes.status).toBe(200);

    // Reading revoked link throws 404
    await expect(getSharedBriefing(shareData.token)).rejects.toThrow();

    // User B cannot revoke User A's link
    actAs(USER_B);
    const userBRevokeReq = nextRequest(`http://localhost:3000/api/briefing/share/${shareData.token}/revoke`, { method: 'POST' });
    const userBRevokeRes = await revokeShareLink(userBRevokeReq, params({ token: shareData.token }));
    expect(userBRevokeRes.status).toBe(404);
  }, 30000);

  it('GET /api/briefing/share/[token]/documents/[id]/file enforces scoping, expiration, and isolation', async () => {
    actAs(USER_A);
    // Create an active share link including docA1 and docA2
    const shareReq = jsonRequest('http://localhost:3000/api/briefing/share', 'POST', {
      title: 'Doctor Verification Link',
      expiresInHours: 24,
    });
    const shareRes = await createShareLink(shareReq);
    expect(shareRes.status).toBe(201);
    const { token } = await shareRes.json();

    // 1. Authorized recipient fetches permitted document file
    const docReq = nextRequest(`http://localhost:3000/api/briefing/share/${token}/documents/${docA1}/file`);
    const docRes = await getSharedDocumentFile(docReq, params({ token, id: docA1 }));
    expect(docRes.status).toBe(200);
    expect(docRes.headers.get('Content-Type')).toBe('text/plain');
    expect(docRes.headers.get('Cache-Control')).toBe('private, no-store');
    expect(docRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(docRes.headers.get('Content-Disposition')).toContain('inline');

    // 2. Cross-user document isolation: recipient cannot fetch User B's document via User A's token
    const crossReq = nextRequest(`http://localhost:3000/api/briefing/share/${token}/documents/${docB1}/file`);
    const crossRes = await getSharedDocumentFile(crossReq, params({ token, id: docB1 }));
    expect(crossRes.status).toBe(404);

    // 3. Unknown document ID returns 404 (both malformed string and valid non-existent UUID)
    const unknownReq = nextRequest(`http://localhost:3000/api/briefing/share/${token}/documents/unknown-id/file`);
    const unknownRes = await getSharedDocumentFile(unknownReq, params({ token, id: 'unknown-id' }));
    expect(unknownRes.status).toBe(404);

    const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
    const nonExistentReq = nextRequest(`http://localhost:3000/api/briefing/share/${token}/documents/${nonExistentUuid}/file`);
    const nonExistentRes = await getSharedDocumentFile(nonExistentReq, params({ token, id: nonExistentUuid }));
    expect(nonExistentRes.status).toBe(404);

    // 4. Invalid token returns 404
    const invalidTokenReq = nextRequest(`http://localhost:3000/api/briefing/share/invalid-token-123/documents/${docA1}/file`);
    const invalidTokenRes = await getSharedDocumentFile(invalidTokenReq, params({ token: 'invalid-token-123', id: docA1 }));
    expect(invalidTokenRes.status).toBe(404);

    // 5. Revoking the share link immediately blocks access (returns 404)
    const revokeReq = nextRequest(`http://localhost:3000/api/briefing/share/${token}/revoke`, { method: 'POST' });
    await revokeShareLink(revokeReq, params({ token }));

    const afterRevokeReq = nextRequest(`http://localhost:3000/api/briefing/share/${token}/documents/${docA1}/file`);
    const afterRevokeRes = await getSharedDocumentFile(afterRevokeReq, params({ token, id: docA1 }));
    expect(afterRevokeRes.status).toBe(404);
  }, 30000);
});
