import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  HAS_DATABASE,
  USER_A,
  USER_B,
  actAs,
  seedUsers,
  cleanup,
  db,
  tables,
  jsonRequest,
  params,
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { setNotifier } from '@/services/ramadan/notify';
import { eq } from 'drizzle-orm';

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

const PLAN = {
  ramadanStart: '2027-02-08',
  ramadanEnd: '2027-03-09',
  intendsToFast: true,
  city: 'karachi',
  caregiverName: 'Ayesha',
  caregiverPhone: '+923001234567',
};

describeIfDb('Ramzan glucose logging', () => {
  beforeAll(async () => {
    await seedUsers();
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
    const { POST } = await import('../plan/route');
    await POST(jsonRequest('http://t/api/ramadan/plan', 'POST', PLAN));
  });

  afterEach(() => setNotifier(null));

  async function log(body: unknown) {
    const { POST } = await import('./route');
    return POST(jsonRequest('http://t/api/ramadan/glucose', 'POST', body));
  }

  async function storedLogs(userId: string) {
    return db.select().from(tables.glucoseLogs).where(eq(tables.glucoseLogs.userId, userId));
  }

  it('raises the low alert for "sugar baasath hai"', async () => {
    const response = await log({ text: 'sugar baasath hai', source: 'voice' });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body).toMatchObject({ status: 'logged', log: { valueMgDl: 62, alertLevel: 'low' } });
    expect(body.alert.action.roman).toBe('Roza foran khol dein aur meetha lein.');
    expect(body.alert.permitted.roman).toBe('Sehat ki khatir roza todna jaiz hai.');

    const [stored] = await storedLogs(USER_A);
    expect(stored).toMatchObject({ valueMgDl: 62, originalText: 'sugar baasath hai', source: 'voice', originalUnit: 'mg_dl' });
    expect(stored.planId).not.toBeNull();
  });

  it('logs a normal reading without an alert', async () => {
    const body = await (await log({ text: 'شوگر ۱۲۰' })).json();
    expect(body).toMatchObject({ status: 'logged', log: { alertLevel: 'none' }, alert: null });
  });

  it('converts mmol/L and applies the same thresholds', async () => {
    const body = await (await log({ value: 3.8, unit: 'mmol_l' })).json();
    expect(body.log.alertLevel).toBe('low');
    expect(body.log.valueMgDl).toBeCloseTo(68.46, 1);
  });

  it('alerts on symptoms with no reading at all', async () => {
    const body = await (await log({ symptoms: ['shaking', 'sweating'] })).json();
    expect(body).toMatchObject({ status: 'logged', log: { valueMgDl: null, alertLevel: 'symptom' } });
  });

  it('asks for the unit of a small unitless number, storing nothing', async () => {
    const response = await log({ text: 'sugar 30' });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/mg\/dL or mmol\/L/);
    expect(await storedLogs(USER_A)).toHaveLength(0);
  });

  it('stores an interpreted value only after the patient confirms it', async () => {
    const first = await log({ text: 'sugar 4.1' });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: 'needs_confirmation', reading: { value: 4.1, unit: 'mmol_l' } });
    expect(await storedLogs(USER_A)).toHaveLength(0);

    const confirmed = await log({ value: 4.1, unit: 'mmol_l', confirmed: true });
    expect(confirmed.status).toBe(201);
    expect(await storedLogs(USER_A)).toHaveLength(1);
  });

  it('tells the caregiver about a low reading', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    setNotifier({ send });

    const body = await (await log({ text: 'sugar 55' })).json();
    expect(body.caregiverNotified).toBe(true);
    expect(send).toHaveBeenCalledWith(
      USER_A,
      expect.objectContaining({ recipient: 'caregiver', contact: { name: 'Ayesha', phone: '+923001234567' } })
    );
  });

  it('still records the reading when the caregiver message fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNotifier({ send: vi.fn().mockRejectedValue(new Error('gateway down')) });

    const response = await log({ text: 'sugar 55' });
    expect(response.status).toBe(201);
    expect((await response.json()).caregiverNotified).toBe(false);
    warn.mockRestore();
  });

  describe('"Done, I broke my fast"', () => {
    async function markBroken(id: string) {
      const { PATCH } = await import('./[id]/route');
      return PATCH(jsonRequest(`http://t/api/ramadan/glucose/${id}`, 'PATCH', { fastBroken: true }), params({ id }));
    }

    it('records when the patient broke the fast', async () => {
      const { log: logged } = await (await log({ text: 'sugar 55' })).json();
      const response = await markBroken(logged.id);
      expect(response.status).toBe(200);

      const [stored] = await storedLogs(USER_A);
      expect(stored.fastBrokenAt).toBeInstanceOf(Date);
    });

    it("cannot be recorded on another user's reading", async () => {
      const { log: logged } = await (await log({ text: 'sugar 55' })).json();

      actAs(USER_B);
      expect((await markBroken(logged.id)).status).toBe(404);

      const [stored] = await storedLogs(USER_A);
      expect(stored.fastBrokenAt).toBeNull();
    });
  });
});
