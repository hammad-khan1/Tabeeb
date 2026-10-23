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

describeIfDb('Ramzan reminder settings', () => {
  let medicineOfA: string;

  beforeAll(async () => {
    await seedUsers();
    const prescription = await seedDocument(USER_A, { documentType: 'prescription' });
    const [row] = await db
      .insert(tables.medications)
      .values({ documentId: prescription, userId: USER_A, name: 'Diamicron MR 60', frequency: 'iftar' })
      .returning({ id: tables.medications.id });
    medicineOfA = row.id;
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
    expect((await POST(jsonRequest('http://t/api/ramadan/plan', 'POST', PLAN))).status).toBe(201);
  }

  async function toggle(body: Record<string, unknown>) {
    const { PATCH } = await import('./route');
    return PATCH(jsonRequest('http://t/api/ramadan/reminders', 'PATCH', { label: 'x', ...body }));
  }

  async function reminders() {
    const { GET } = await import('../today/route');
    return (await (await GET()).json()).reminders as Array<{ slot: string; kind: string; active: boolean }>;
  }

  it('turns a reminder off, and back on, for the rest of the plan', async () => {
    expect((await toggle({ kind: 'glucose_check', slot: 'midday', active: false })).status).toBe(200);
    expect((await reminders()).find((r) => r.slot === 'midday')?.active).toBe(false);
    expect((await reminders()).find((r) => r.slot === 'iftar')?.active).toBe(true);

    await toggle({ kind: 'glucose_check', slot: 'midday', active: true });
    expect((await reminders()).find((r) => r.slot === 'midday')?.active).toBe(true);

    const rows = await db.select().from(tables.ramadanReminders).where(eq(tables.ramadanReminders.userId, USER_A));
    expect(rows).toHaveLength(1);
  });

  it("does not change another user's reminders", async () => {
    await toggle({ kind: 'glucose_check', slot: 'midday', active: false });

    actAs(USER_B);
    await createPlan();
    expect((await reminders()).find((r) => r.slot === 'midday')?.active).toBe(true);
  });

  it("refuses another user's medicine", async () => {
    actAs(USER_B);
    await createPlan();
    expect((await toggle({ kind: 'medicine', slot: 'iftar', medicationId: medicineOfA, active: false })).status).toBe(404);
  });
});
