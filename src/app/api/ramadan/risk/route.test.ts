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
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

const PLAN = { ramadanStart: '2027-02-08', ramadanEnd: '2027-03-09', intendsToFast: true, city: 'karachi' };

interface RiskBody {
  filled: Array<{ item: string; option: string; provenance: Record<string, unknown> }>;
  pending: Array<{ item: string; reason: string; hints: Array<Record<string, unknown>> }>;
  items: Array<{ item: string; option: string; source: string; provenance?: Record<string, unknown> }>;
  result: { status: string; unverified?: string[] };
}

describeIfDb('Ramzan risk score', () => {
  let daonilId: string;
  let prescriptionId: string;

  beforeAll(async () => {
    await seedUsers();

    // The demo patient: type 2 for twelve years, glibenclamide and metformin, HbA1c 9.2.
    const clinicNote = await seedDocument(USER_A, { documentType: 'consultation_note' });
    prescriptionId = await seedDocument(USER_A, { documentType: 'prescription' });
    const labReport = await seedDocument(USER_A, { documentType: 'lab_report' });

    await db.insert(tables.diagnoses).values({
      documentId: clinicNote,
      userId: USER_A,
      condition: 'Type 2 DM',
      canonicalCondition: 'Type 2 diabetes mellitus',
      diagnosedDate: new Date(Date.now() - 12 * 365 * DAY),
    });
    const [daonil] = await db
      .insert(tables.medications)
      .values([
        { documentId: prescriptionId, userId: USER_A, name: 'Daonil 5mg', frequency: '1+0+1' },
        { documentId: prescriptionId, userId: USER_A, name: 'Glucophage 500mg', frequency: '1+0+1' },
      ])
      .returning({ id: tables.medications.id });
    daonilId = daonil.id;
    await db.insert(tables.labResults).values([
      {
        documentId: labReport,
        userId: USER_A,
        testName: 'HbA1c',
        canonicalTestName: 'hba1c',
        value: '9.2',
        numericValue: 9.2,
        canonicalValue: 9.2,
        canonicalUnit: '%',
        unit: '%',
        testDate: new Date(Date.now() - 30 * DAY),
      },
      {
        documentId: labReport,
        userId: USER_A,
        testName: 'S. Creatinine',
        canonicalTestName: 'creatinine',
        value: '0.9',
        numericValue: 0.9,
        canonicalValue: 0.9,
        canonicalUnit: 'mg/dL',
        unit: 'mg/dL',
        testDate: new Date(Date.now() - 30 * DAY),
      },
    ]);
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    for (const user of [USER_A, USER_B]) {
      await db.delete(tables.ramadanPlans).where(eq(tables.ramadanPlans.userId, user));
    }
    actAs(USER_A);
    await createPlan();
  });

  async function createPlan() {
    const { POST } = await import('../plan/route');
    const response = await POST(jsonRequest('http://t/api/ramadan/plan', 'POST', PLAN));
    expect(response.status).toBe(201);
  }

  async function getRisk(): Promise<RiskBody> {
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    return response.json();
  }

  async function answer(answers: Array<{ item: string; option: string }>) {
    const { POST } = await import('./route');
    return POST(jsonRequest('http://t/api/ramadan/risk', 'POST', { answers }));
  }

  it('fills the score from the record, with provenance for every value', async () => {
    const body = await getRisk();
    const filled = Object.fromEntries(body.filled.map((input) => [input.item, input]));

    expect(filled.treatment).toMatchObject({
      option: 'glibenclamide',
      provenance: { table: 'medications', rowId: daonilId, documentId: prescriptionId },
    });
    expect(filled.hba1c.option).toBe('over_9');
    expect(filled.diabetes_type.option).toBe('type2');
    expect(filled.diabetes_duration.option).toBe('ten_or_more');
    expect(filled.fasting_hours).toMatchObject({ option: 'under_sixteen', provenance: { table: 'prayer_times' } });
  });

  it('asks for kidney function, showing creatinine without computing eGFR from it', async () => {
    const renal = (await getRisk()).pending.find((input) => input.item === 'renal');
    expect(renal).toMatchObject({ reason: 'needs_detail', hints: [{ table: 'lab_results', value: '0.9 mg/dL' }] });
  });

  it('saves answers but gives no score while guideline values are unverified', async () => {
    const response = await answer([{ item: 'physical_labour', option: 'none' }]);
    expect(response.status).toBe(200);

    const body: RiskBody = await response.json();
    expect(body.result.status).toBe('incomplete');
    expect(body.result.unverified).toContain('physical_labour');

    const [plan] = await db.select().from(tables.ramadanPlans).where(eq(tables.ramadanPlans.userId, USER_A));
    expect(plan.riskScore).toBeNull();
    expect(plan.riskBand).toBeNull();
    expect(plan.scoreItems?.find((item) => item.item === 'physical_labour')).toMatchObject({
      option: 'none',
      source: 'answer',
      points: null,
    });
  });

  it('keeps earlier answers when more arrive', async () => {
    await answer([{ item: 'physical_labour', option: 'none' }]);
    const body: RiskBody = await (await answer([{ item: 'previous_ramadan', option: 'not_negative' }])).json();

    const answered = body.items.filter((item) => item.source === 'answer').map((item) => item.item);
    expect(answered).toEqual(expect.arrayContaining(['physical_labour', 'previous_ramadan']));
    expect(body.pending.map((input) => input.item)).not.toContain('physical_labour');
  });

  it('records an override with the record value it replaced', async () => {
    const body: RiskBody = await (await answer([{ item: 'treatment', option: 'other' }])).json();

    expect(body.items.find((item) => item.item === 'treatment')).toMatchObject({
      option: 'other',
      source: 'override',
      provenance: { rowId: daonilId },
    });
  });

  it('rejects an option that does not belong to the item', async () => {
    expect((await answer([{ item: 'treatment', option: 'over_9' }])).status).toBe(400);
    expect((await answer([{ item: 'not_an_item', option: 'none' }])).status).toBe(400);
  });

  it("never fills one user's score from another user's record", async () => {
    actAs(USER_B);
    await createPlan();

    const body = await getRisk();
    expect(body.filled.map((input) => input.item)).toEqual(['fasting_hours']);
    expect(JSON.stringify(body)).not.toContain(daonilId);
  });

  it('needs a plan first', async () => {
    await db.delete(tables.ramadanPlans).where(eq(tables.ramadanPlans.userId, USER_A));
    const { GET } = await import('./route');
    expect((await GET()).status).toBe(404);
  });
});
