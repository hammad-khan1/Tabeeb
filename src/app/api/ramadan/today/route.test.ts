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

const PLAN = { ramadanStart: '2027-02-08', ramadanEnd: '2027-03-09', intendsToFast: true, city: 'karachi' };

interface TodayBody {
  sehriEnds: string;
  iftar: string;
  reminders: Array<{ kind: string; slot: string; label: string }>;
  unscheduled: Array<{ name: string; reason: string }>;
  askDoctor: boolean;
  readings: unknown[];
}

describeIfDb("Ramzan today's schedule", () => {
  let doctorPlanDocument: string;

  beforeAll(async () => {
    await seedUsers();

    const everydayPrescription = await seedDocument(USER_A, { documentType: 'prescription' });
    doctorPlanDocument = await seedDocument(USER_A, { documentType: 'prescription', title: 'Ramzan prescription' });
    await db.insert(tables.medications).values([
      { documentId: everydayPrescription, userId: USER_A, name: 'Daonil 5mg', frequency: '1+0+1' },
      { documentId: doctorPlanDocument, userId: USER_A, name: 'Diamicron MR 60', frequency: 'iftar' },
    ]);
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
    const { POST } = await import('../plan/route');
    expect((await POST(jsonRequest('http://t/api/ramadan/plan', 'POST', PLAN))).status).toBe(201);
  }

  async function today(): Promise<TodayBody> {
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    return response.json();
  }

  it('needs a plan first', async () => {
    const { GET } = await import('./route');
    expect((await GET()).status).toBe(404);
  });

  it("gives Sehri and Iftar for the plan's city", async () => {
    await createPlan();
    const body = await today();

    const sehri = new Date(body.sehriEnds).getTime();
    const iftar = new Date(body.iftar).getTime();
    expect(iftar).toBeGreaterThan(sehri);
    expect(body.reminders.filter((r) => r.kind !== 'medicine').map((r) => r.slot)).toEqual([
      'sehri', 'midday', 'pre_iftar', 'iftar', 'post_iftar',
    ]);
  });

  it('lists current medicines for the doctor without moving them', async () => {
    await createPlan();
    const body = await today();

    expect(body.reminders.filter((r) => r.kind === 'medicine')).toEqual([]);
    expect(body.unscheduled.map((m) => m.reason)).toEqual(['awaiting_doctor_plan', 'awaiting_doctor_plan']);
    expect(body.askDoctor).toBe(true);
  });

  it("schedules only the doctor's Ramzan prescription once it is linked", async () => {
    await createPlan();
    const { PATCH } = await import('../plan/route');
    await PATCH(jsonRequest('http://t/api/ramadan/plan', 'PATCH', { doctorPlanDocumentId: doctorPlanDocument }));

    const body = await today();
    expect(body.reminders.filter((r) => r.kind === 'medicine').map((r) => `${r.label}:${r.slot}`)).toEqual([
      'Diamicron MR 60:iftar',
    ]);
    expect(body.unscheduled).toEqual([]);
  });

  it("never shows one user's readings to another", async () => {
    await createPlan();
    const { POST } = await import('../glucose/route');
    await POST(jsonRequest('http://t/api/ramadan/glucose', 'POST', { text: 'sugar 55' }));
    expect((await today()).readings).toHaveLength(1);

    actAs(USER_B);
    await createPlan();
    const body = await today();
    expect(body.readings).toEqual([]);
    expect(body.unscheduled).toEqual([]);
  });
});
