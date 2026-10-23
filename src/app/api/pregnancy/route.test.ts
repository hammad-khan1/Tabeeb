import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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
import { setNotifier } from '@/services/notify';
import { localDate } from '@/services/ramadan/prayer-times';
import { addDays } from '@/services/pregnancy/timeline';
import { eq } from 'drizzle-orm';

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

const TODAY = localDate();
/** 28 weeks pregnant today. */
const LMP = addDays(TODAY, -28 * 7);

describeIfDb('Mother-care', () => {
  let pregnancyId: string;

  beforeAll(async () => {
    await seedUsers();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    for (const user of [USER_A, USER_B]) {
      await db.delete(tables.pregnancies).where(eq(tables.pregnancies.userId, user));
    }
    actAs(USER_A);
    pregnancyId = await create({ motherName: 'Ayesha', enteredBy: 'family', consentConfirmed: true, lmpDate: LMP });
  });

  afterEach(() => setNotifier(null));

  async function create(body: Record<string, unknown>): Promise<string> {
    const response = await post(body);
    expect(response.status).toBe(201);
    return (await response.json()).pregnancy.id;
  }

  async function post(body: Record<string, unknown>) {
    const { POST } = await import('./route');
    return POST(jsonRequest('http://t/api/pregnancy', 'POST', body));
  }

  async function view(id = pregnancyId) {
    const { GET } = await import('./[id]/route');
    return GET(nextRequest(`http://t/api/pregnancy/${id}`), params({ id }));
  }

  async function action(path: string, method: string, body?: unknown, id = pregnancyId) {
    const route = await import(`./[id]/${path}/route`);
    return route[method](jsonRequest(`http://t/api/pregnancy/${id}/${path}`, method, body), params({ id }));
  }

  describe('starting a record', () => {
    it('works out the week, due date and eight visits from the last period', async () => {
      const body = await (await view()).json();
      expect(body.gestationalAge).toMatchObject({ weeks: 28, days: 0 });
      expect(body.pregnancy.dueDate).toBe(addDays(LMP, 280));
      expect(body.schedule.map((c: { week: number }) => c.week)).toEqual([12, 20, 26, 30, 34, 36, 38, 40]);
      // The 26-week visit stays due for two weeks after its week, so at 28 weeks it is next.
      expect(body.nextContact).toMatchObject({ number: 3, week: 26, status: 'due' });
    });

    it('accepts a due date instead of the last period', async () => {
      const id = await create({ motherName: 'Sana', enteredBy: 'self', dueDate: addDays(TODAY, 70) });
      const body = await (await view(id)).json();
      expect(body.gestationalAge.weeks).toBe(30);
    });

    it('needs her agreement when a family member starts it', async () => {
      const response = await post({ motherName: 'Ayesha', enteredBy: 'family', lmpDate: LMP });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Ayesha has agreed/);
    });

    it('rejects a last period in the future, and both dates at once', async () => {
      expect((await post({ motherName: 'A', enteredBy: 'self', lmpDate: addDays(TODAY, 3) })).status).toBe(400);
      expect(
        (await post({ motherName: 'A', enteredBy: 'self', lmpDate: LMP, dueDate: addDays(TODAY, 70) })).status
      ).toBe(400);
    });
  });

  describe('visits, tablets and readings', () => {
    it('files visit notes under a visit and marks it done', async () => {
      const notes = await seedDocument(USER_A, { documentType: 'consultation_note' });
      const response = await action('contacts', 'PATCH', {
        contactNumber: 3,
        doneOn: addDays(TODAY, -14),
        documentId: notes,
      });
      expect(response.status).toBe(200);

      const body = await (await view()).json();
      expect(body.schedule[2]).toMatchObject({ status: 'done', documentId: notes });
      expect(body.linkedDocuments.map((d: { id: string }) => d.id)).toContain(notes);
    });

    it("refuses to file another account's document", async () => {
      const othersDocument = await seedDocument(USER_B);
      expect((await action('contacts', 'PATCH', { contactNumber: 3, documentId: othersDocument })).status).toBe(404);
    });

    it('counts the iron tablet once a day', async () => {
      for (const day of [addDays(TODAY, -1), TODAY, TODAY]) {
        expect((await action('supplements', 'POST', { kind: 'iron_folic', day })).status).toBe(201);
      }
      expect((await (await view()).json()).iron).toEqual({ takenToday: true, streak: 2, totalDays: 2 });
    });

    it('reads Hb only from documents linked to this pregnancy', async () => {
      // The account holder's own report must not appear in her history.
      const hers = await seedDocument(USER_A, { documentType: 'lab_report', title: 'Ayesha CBC' });
      const his = await seedDocument(USER_A, { documentType: 'lab_report', title: 'Husband CBC' });
      const hb = (documentId: string, value: number, daysAgo: number) => ({
        documentId,
        userId: USER_A,
        testName: 'Hb',
        canonicalTestName: 'hemoglobin',
        value: String(value),
        canonicalValue: value,
        canonicalUnit: 'g/dL',
        testDate: new Date(Date.now() - daysAgo * 86_400_000),
      });
      await db.insert(tables.labResults).values([hb(hers, 11.6, 90), hb(hers, 10.9, 45), hb(hers, 10.1, 5), hb(his, 15.2, 10)]);
      await action('documents', 'POST', { documentId: hers });

      const body = await (await view()).json();
      expect(body.hb.readings.map((r: { value: number }) => r.value)).toEqual([11.6, 10.9, 10.1]);
      expect(body.hb.falling).toBe(true);
    });

    it('keeps blood pressure readings', async () => {
      expect((await action('bp', 'POST', { systolic: 128, diastolic: 84 })).status).toBe(201);
      expect((await action('bp', 'POST', { systolic: 80, diastolic: 90 })).status).toBe(400);
      expect((await (await view()).json()).bp).toHaveLength(1);
    });
  });

  describe('danger signs', () => {
    it('alerts the family she chose, and opens her emergency summary', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      setNotifier({ send });
      await action('caregivers', 'POST', { name: 'Ammi', relation: 'mother-in-law', phone: '+923001234567' });
      await action('caregivers', 'POST', { name: 'Bhabi', phone: '+923007654321', receivesAlerts: false });

      const response = await action('danger', 'POST', { sign: 'headache_vision_swelling' });
      expect(response.status).toBe(201);
      const body = await response.json();

      expect(body.instruction.roman).toBe('Foran hospital jayein');
      expect(body.caregiversNotified).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1]).toMatchObject({ kind: 'pregnancy_danger', contact: { name: 'Ammi' } });
      expect(body.emergency.qrSvg).toMatch(/^<svg/);

      const events = await db.select().from(tables.dangerEvents).where(eq(tables.dangerEvents.pregnancyId, pregnancyId));
      expect(events).toMatchObject([{ sign: 'headache_vision_swelling', phase: 'antenatal', caregiversNotified: 1 }]);
    });

    it('serves the emergency summary, never as a history share', async () => {
      const body = await (await action('danger', 'POST', { sign: 'bleeding' })).json();
      const token = body.emergency.url.split('/share/')[1];

      const { getSharedEmergencySummary } = await import('@/services/pregnancy/pregnancy');
      const shared = await getSharedEmergencySummary(token);
      expect(shared.summary).toMatchObject({ motherName: 'Ayesha', weeks: 28 });
      expect(shared.summary.recentDangerSigns[0].text).toBe('Bleeding from the vagina, at any stage');

      const { getSharedHistory } = await import('@/services/history/share');
      await expect(getSharedHistory(token)).rejects.toThrow();
    });

    it('rejects a sign that is not on the fixed list', async () => {
      expect((await action('danger', 'POST', { sign: 'mild_cramp' })).status).toBe(400);
    });
  });

  describe('her record is hers', () => {
    it('is invisible and unchangeable from another account', async () => {
      actAs(USER_B);
      expect((await view()).status).toBe(404);
      expect((await action('contacts', 'PATCH', { contactNumber: 1, doneOn: TODAY })).status).toBe(404);
      expect((await action('caregivers', 'POST', { name: 'X', phone: '+923000000000' })).status).toBe(404);
      expect((await action('danger', 'POST', { sign: 'bleeding' })).status).toBe(404);

      const { GET } = await import('./route');
      expect(await (await GET()).json()).toEqual([]);
    });

    it('lets her remove a family member', async () => {
      const { caregiver } = await (await action('caregivers', 'POST', { name: 'Ammi', phone: '+923001234567' })).json();
      const route = await import('./[id]/caregivers/route');
      const response = await route.DELETE(
        nextRequest(`http://t/api/pregnancy/${pregnancyId}/caregivers?caregiverId=${caregiver.id}`, { method: 'DELETE' }),
        params({ id: pregnancyId })
      );
      expect(response.status).toBe(200);
      expect((await (await view()).json()).caregivers).toEqual([]);
    });

    it('deletes everything with the record', async () => {
      await action('supplements', 'POST', { kind: 'iron_folic', day: TODAY });
      const route = await import('./[id]/route');
      const response = await route.DELETE(nextRequest(`http://t/api/pregnancy/${pregnancyId}`, { method: 'DELETE' }), params({ id: pregnancyId }));
      expect(response.status).toBe(200);

      expect(await db.select().from(tables.ancContacts).where(eq(tables.ancContacts.pregnancyId, pregnancyId))).toEqual([]);
      expect(await db.select().from(tables.supplementLogs).where(eq(tables.supplementLogs.pregnancyId, pregnancyId))).toEqual([]);
    });
  });

  it('reads the due date from an ultrasound report for the family to confirm', async () => {
    const due = addDays(TODAY, 84);
    const [year, month, day] = due.split('-');
    const report = await seedDocument(USER_A, {
      documentType: 'imaging_report',
      rawExtractedText: `Obstetric ultrasound. Single live fetus. EDD: ${day}/${month}/${year}`,
    });

    const { POST } = await import('./due-date/route');
    const response = await POST(jsonRequest('http://t/api/pregnancy/due-date', 'POST', { documentId: report }));
    expect((await response.json()).candidates[0].date).toBe(due);

    actAs(USER_B);
    expect((await POST(jsonRequest('http://t/api/pregnancy/due-date', 'POST', { documentId: report }))).status).toBe(404);
  });
});
