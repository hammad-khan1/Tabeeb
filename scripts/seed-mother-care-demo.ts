/**
 * Seeds the Mother-care demo: Ayesha, 28 weeks pregnant, kept on her husband's account.
 *
 *   npx tsx scripts/seed-mother-care-demo.ts                       # a standalone demo account
 *   npx tsx scripts/seed-mother-care-demo.ts --user user_2abc...   # into your own Clerk account
 *
 * Ayesha has had three check-ups, her 30-week check-up falls on a Monday, she has taken
 * her iron tablet 21 days in a row, her Hb has fallen at each of three tests, and her
 * mother-in-law receives visit reminders and danger alerts. All of it is fictional.
 *
 * Without --user, the demo account is deleted and recreated on every run. With --user,
 * the record is added to that account and nothing existing is deleted.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const DEMO_USER_ID = 'demo_mother_care_husband';
const DAY = 24 * 60 * 60 * 1000;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const { getDb } = await import('../src/lib/db');
  const schema = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');
  const { localDate } = await import('../src/services/ramadan/prayer-times');
  const { addDays } = await import('../src/services/pregnancy/timeline');
  const care = await import('../src/services/pregnancy/pregnancy');

  const db = getDb();
  const userId = argument('--user') ?? DEMO_USER_ID;
  const today = localDate();

  if (userId === DEMO_USER_ID) {
    await db.delete(schema.users).where(eq(schema.users.id, DEMO_USER_ID));
  }
  await db
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@demo.tabeeb.local`, name: 'Demo husband (Mother-care)' })
    .onConflictDoNothing();

  // The 30-week check-up lands on the Monday after next, so today she is 28 weeks.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const daysToNextMonday = ((8 - weekday) % 7) || 7;
  const thirtyWeekVisit = addDays(today, daysToNextMonday + 7);
  const lmp = addDays(thirtyWeekVisit, -30 * 7);

  const pregnancy = await care.createPregnancy(
    userId,
    {
      motherName: 'Ayesha',
      enteredBy: 'family',
      consentConfirmed: true,
      lmpDate: lmp,
      bloodGroup: 'B+',
      ttDosesBefore: 0,
      pastComplications: ['Miscarriage at 10 weeks (2023)'],
    },
    today
  );

  for (const [number, week] of [[1, 10], [2, 20], [3, 26]] as const) {
    await care.updateContact(userId, pregnancy.id, number, { doneOn: addDays(lmp, week * 7 + 1) }, today);
  }

  // Tetanus: none before, both doses given in this pregnancy, four weeks apart.
  await care.logSupplement(userId, pregnancy.id, 'tt_dose', addDays(lmp, 20 * 7 + 1), today);
  await care.logSupplement(userId, pregnancy.id, 'tt_dose', addDays(lmp, 25 * 7), today);
  for (let daysAgo = 20; daysAgo >= 0; daysAgo -= 1) {
    await care.logSupplement(userId, pregnancy.id, 'iron_folic', addDays(today, -daysAgo), today);
  }

  const [report] = await db
    .insert(schema.documents)
    .values({
      userId,
      title: '[Demo] Ayesha — blood reports',
      documentType: 'lab_report',
      hospital: 'Demo Hospital, Lahore',
      documentDate: new Date(Date.now() - 10 * DAY),
      fileName: 'demo.txt',
      mimeType: 'text/plain',
      fileSize: 0,
      storagePath: `${userId}/demo-not-on-disk.txt`,
      extractionStatus: 'confirmed',
      rawExtractedText: 'CBC (fictional demo record)',
    })
    .returning({ id: schema.documents.id });

  await db.insert(schema.labResults).values(
    ([[11.4, 100], [10.8, 50], [10.2, 10]] as const).map(([value, daysAgo]) => ({
      documentId: report.id,
      userId,
      testName: 'Haemoglobin',
      canonicalTestName: 'hemoglobin',
      value: String(value),
      numericValue: value,
      canonicalValue: value,
      unit: 'g/dL',
      canonicalUnit: 'g/dL',
      referenceRange: '11.0 - 15.0',
      testDate: new Date(Date.now() - daysAgo * DAY),
    }))
  );
  await care.linkDocument(userId, pregnancy.id, report.id);

  for (const [systolic, diastolic, daysAgo] of [[118, 76, 60], [122, 80, 30], [126, 82, 3]] as const) {
    await db.insert(schema.bpReadings).values({
      pregnancyId: pregnancy.id,
      userId,
      systolic,
      diastolic,
      measuredAt: new Date(Date.now() - daysAgo * DAY),
    });
  }

  await care.addCaregiver(userId, pregnancy.id, {
    name: 'Ammi (saas)',
    relation: 'mother-in-law',
    phone: '+923001234567',
  });

  const view = await care.getPregnancyView(userId, pregnancy.id, today);
  console.log(`Seeded Ayesha on account ${userId}`);
  console.log(
    `  ${view.gestationalAge.weeks} weeks ${view.gestationalAge.days} days · 30-week check-up on ${thirtyWeekVisit} (a Monday)` +
      ` · iron ${view.iron.streak} days in a row · Hb falling: ${view.hb.falling}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
