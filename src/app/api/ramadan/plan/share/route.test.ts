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
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

const PLAN = { ramadanStart: '2027-02-08', ramadanEnd: '2027-03-09', intendsToFast: true, city: 'karachi' };

describeIfDb('Ramzan plan sheet links', () => {
  beforeAll(async () => {
    await seedUsers();

    const prescription = await seedDocument(USER_A, { documentType: 'prescription' });
    await db.insert(tables.medications).values({ documentId: prescription, userId: USER_A, name: 'Daonil 5mg' });
    const othersPrescription = await seedDocument(USER_B, { documentType: 'prescription' });
    await db.insert(tables.medications).values({ documentId: othersPrescription, userId: USER_B, name: 'Sertraline' });
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    for (const user of [USER_A, USER_B]) {
      await db.delete(tables.glucoseLogs).where(eq(tables.glucoseLogs.userId, user));
      await db.delete(tables.ramadanPlans).where(eq(tables.ramadanPlans.userId, user));
    }
    actAs(USER_A);
  });

  async function createPlan() {
    const { POST } = await import('../route');
    expect((await POST(jsonRequest('http://t/api/ramadan/plan', 'POST', PLAN))).status).toBe(201);
  }

  async function createLink(): Promise<string> {
    const { POST } = await import('./route');
    const response = await POST(jsonRequest('http://t/api/ramadan/plan/share', 'POST', {}));
    expect(response.status).toBe(201);
    return (await response.json()).token;
  }

  async function readSheet(token: string) {
    const { getSharedPlanSheet } = await import('@/services/ramadan/plan-sheet');
    return getSharedPlanSheet(token);
  }

  it("gives the doctor the plan, the patient's medicines and recent readings", async () => {
    await createPlan();
    const { POST } = await import('../../glucose/route');
    await POST(jsonRequest('http://t/api/ramadan/glucose', 'POST', { text: 'sugar 55' }));

    const { sheet } = await readSheet(await createLink());
    expect(sheet.plan).toMatchObject({ year: 2027, city: 'Karachi' });
    expect(sheet.medications.map((m) => m.name)).toEqual(['Daonil 5mg']);
    expect(sheet.glucose).toHaveLength(1);
  });

  it("contains nothing of another user's record", async () => {
    await createPlan();
    actAs(USER_B);
    await createPlan();
    const { POST } = await import('../../glucose/route');
    await POST(jsonRequest('http://t/api/ramadan/glucose', 'POST', { text: 'sugar 250' }));

    actAs(USER_A);
    const shared = await readSheet(await createLink());
    expect(JSON.stringify(shared)).not.toContain('Sertraline');
    expect(shared.sheet.glucose).toEqual([]);
  });

  it('cannot be opened as a history share, which would expose the whole record', async () => {
    await createPlan();
    const token = await createLink();

    const { getSharedHistory } = await import('@/services/history/share');
    await expect(getSharedHistory(token)).rejects.toThrow();
  });

  it('is listed with the plan, not with history shares', async () => {
    await createPlan();
    const token = await createLink();

    const { GET } = await import('./route');
    const planLinks = await (await GET()).json();
    expect(planLinks.map((link: { token: string }) => link.token)).toEqual([token]);

    const history = await import('@/app/api/history/share/route');
    expect(await (await history.GET()).json()).toEqual([]);
  });

  it('stops working once revoked, and only its owner can revoke it', async () => {
    await createPlan();
    const token = await createLink();
    const { DELETE } = await import('./route');

    actAs(USER_B);
    const refused = await DELETE(nextRequest(`http://t/api/ramadan/plan/share?token=${token}`, { method: 'DELETE' }));
    expect(refused.status).toBe(404);
    await expect(readSheet(token)).resolves.toBeTruthy();

    actAs(USER_A);
    await DELETE(nextRequest(`http://t/api/ramadan/plan/share?token=${token}`, { method: 'DELETE' }));
    await expect(readSheet(token)).rejects.toThrow(/no longer available/);
  });

  it('needs a plan first', async () => {
    const { POST } = await import('./route');
    expect((await POST(jsonRequest('http://t/api/ramadan/plan/share', 'POST', {}))).status).toBe(404);
  });
});
