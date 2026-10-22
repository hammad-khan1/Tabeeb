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

const PLAN = {
  ramadanStart: '2027-02-08',
  ramadanEnd: '2027-03-09',
  intendsToFast: true,
  city: 'karachi',
};

describeIfDb('Ramzan plan', () => {
  beforeAll(async () => {
    await seedUsers();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    actAs(USER_A);
    await db.delete(tables.ramadanPlans).where(eq(tables.ramadanPlans.userId, USER_A));
    await db.delete(tables.ramadanPlans).where(eq(tables.ramadanPlans.userId, USER_B));
  });

  async function post(body: unknown) {
    const { POST } = await import('./route');
    return POST(jsonRequest('http://t/api/ramadan/plan', 'POST', body));
  }

  async function get() {
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    return response.json();
  }

  it('offers the opt-in with estimated dates and cities when there is no plan', async () => {
    const body = await get();
    expect(body.plan).toBeNull();
    expect(body.estimatedDates).toMatchObject({ year: 2027 });
    expect(body.cities.map((city: { id: string }) => city.id)).toContain('karachi');
  });

  it('knows whether the patient has diabetes', async () => {
    expect((await get()).hasDiabetes).toBe(false);

    const documentId = await seedDocument(USER_A);
    await db.insert(tables.diagnoses).values({
      documentId,
      userId: USER_A,
      condition: 'DM type II',
      canonicalCondition: 'Type 2 diabetes mellitus',
    });
    expect((await get()).hasDiabetes).toBe(true);
  });

  it('creates a plan with the city\'s coordinates', async () => {
    const response = await post(PLAN);
    expect(response.status).toBe(201);

    const { plan } = await response.json();
    expect(plan).toMatchObject({ year: 2027, city: 'Karachi', status: 'active', intendsToFast: true });
    expect(plan.latitude).toBeCloseTo(24.86, 1);
  });

  it('keeps one plan per year, updating it on a second save', async () => {
    await post(PLAN);
    await post({ ...PLAN, city: 'lahore', intendsToFast: false });

    const rows = await db.select().from(tables.ramadanPlans).where(eq(tables.ramadanPlans.userId, USER_A));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ city: 'Lahore', status: 'draft' });
  });

  it('accepts browser coordinates instead of a city', async () => {
    const { ramadanStart, ramadanEnd, intendsToFast } = PLAN;
    const response = await post({ ramadanStart, ramadanEnd, intendsToFast, latitude: 24.9, longitude: 67.1 });
    expect(response.status).toBe(201);
    expect((await response.json()).plan.city).toBeNull();
  });

  it('rejects an unknown city, impossible dates and a month of the wrong length', async () => {
    expect((await post({ ...PLAN, city: 'atlantis' })).status).toBe(400);
    expect((await post({ ...PLAN, ramadanStart: '2027-02-30' })).status).toBe(400);
    expect((await post({ ...PLAN, ramadanEnd: '2027-02-20' })).status).toBe(400);
  });

  it("does not show one user's plan to another", async () => {
    await post(PLAN);

    actAs(USER_B);
    expect((await get()).plan).toBeNull();
  });

  describe('linking the doctor\'s Ramzan prescription', () => {
    async function patch(body: unknown) {
      const { PATCH } = await import('./route');
      return PATCH(jsonRequest('http://t/api/ramadan/plan', 'PATCH', body));
    }

    it('links the patient\'s own document and marks the plan doctor-confirmed', async () => {
      await post(PLAN);
      const documentId = await seedDocument(USER_A, { documentType: 'prescription' });

      const response = await patch({ doctorPlanDocumentId: documentId });
      expect(response.status).toBe(200);
      expect((await response.json()).plan).toMatchObject({ doctorPlanDocumentId: documentId, doctorConfirmed: true });
    });

    it("refuses another user's document", async () => {
      await post(PLAN);
      const othersDocument = await seedDocument(USER_B, { documentType: 'prescription' });

      expect((await patch({ doctorPlanDocumentId: othersDocument })).status).toBe(404);
    });

    it('needs a plan first', async () => {
      expect((await patch({ doctorPlanDocumentId: null })).status).toBe(404);
    });
  });
});
