/**
 * Seeds a Ramzan Mode demo patient.
 *
 *   npx tsx scripts/seed-ramzan-demo.ts                        # a standalone demo user
 *   npx tsx scripts/seed-ramzan-demo.ts --user user_2abc...    # into your own Clerk account
 *   npx tsx scripts/seed-ramzan-demo.ts --with-plan            # also a Karachi plan and a doctor link
 *
 * The patient: type 2 diabetes for 12 years, on glibenclamide (Daonil) and metformin
 * (Glucophage), HbA1c 9.2%, normal creatinine, and three past glucose readings. All of
 * it is fictional.
 *
 * Without --user, the demo user is deleted and recreated on every run. With --user, the
 * records are added to that account and nothing existing is deleted; the documents are
 * titled "[Demo]" so they are easy to find and remove.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const DEMO_USER_ID = 'demo_ramzan_patient';
const DAY = 24 * 60 * 60 * 1000;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  // Imported after dotenv, which db.ts needs for DATABASE_URL.
  const { getDb } = await import('../src/lib/db');
  const schema = await import('../drizzle/schema');
  const { eq } = await import('drizzle-orm');

  const db = getDb();
  const userId = argument('--user') ?? DEMO_USER_ID;
  const withPlan = process.argv.includes('--with-plan');
  const now = Date.now();

  if (userId === DEMO_USER_ID) {
    // Cascades remove the demo user's documents, records, plans, logs and links.
    await db.delete(schema.users).where(eq(schema.users.id, DEMO_USER_ID));
  }
  await db
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@demo.tabeeb.local`, name: 'Demo patient (Ramzan)' })
    .onConflictDoNothing();

  async function document(
    title: string,
    documentType: (typeof schema.documentTypeEnum.enumValues)[number],
    daysAgo: number
  ): Promise<string> {
    const [row] = await db
      .insert(schema.documents)
      .values({
        userId,
        title: `[Demo] ${title}`,
        documentType,
        hospital: 'Demo Clinic, Karachi',
        doctorName: 'Dr. Demo',
        documentDate: new Date(now - daysAgo * DAY),
        fileName: 'demo.txt',
        mimeType: 'text/plain',
        fileSize: 0,
        storagePath: `${userId}/demo-not-on-disk.txt`,
        extractionStatus: 'confirmed',
        rawExtractedText: `${title} (fictional demo record)`,
      })
      .returning({ id: schema.documents.id });
    return row.id;
  }

  const note = await document('Diabetes follow-up', 'consultation_note', 20);
  const prescription = await document('Prescription', 'prescription', 20);
  const labs = await document('Lab report', 'lab_report', 21);

  await db.insert(schema.diagnoses).values({
    documentId: note,
    userId,
    condition: 'Type 2 DM',
    canonicalCondition: 'Type 2 diabetes mellitus',
    icd10Code: 'E11.9',
    assertionStatus: 'present',
    diagnosedDate: new Date(now - 12 * 365 * DAY),
  });

  await db.insert(schema.medications).values([
    {
      documentId: prescription,
      userId,
      name: 'Daonil 5mg',
      genericName: 'glibenclamide',
      dosage: '5mg',
      frequency: '1+0+1',
      prescribedDate: new Date(now - 20 * DAY),
    },
    {
      documentId: prescription,
      userId,
      name: 'Glucophage 500mg',
      genericName: 'metformin',
      dosage: '500mg',
      frequency: '1+0+1 khane ke baad',
      prescribedDate: new Date(now - 20 * DAY),
    },
  ]);

  const testDate = new Date(now - 21 * DAY);
  await db.insert(schema.labResults).values([
    {
      documentId: labs,
      userId,
      testName: 'HbA1c',
      canonicalTestName: 'hba1c',
      value: '9.2',
      numericValue: 9.2,
      canonicalValue: 9.2,
      unit: '%',
      canonicalUnit: '%',
      referenceRange: '4.0 - 5.6',
      isAbnormal: true,
      testDate,
    },
    {
      documentId: labs,
      userId,
      testName: 'Serum Creatinine',
      canonicalTestName: 'creatinine',
      value: '0.9',
      numericValue: 0.9,
      canonicalValue: 0.9,
      unit: 'mg/dL',
      canonicalUnit: 'mg/dL',
      referenceRange: '0.6 - 1.2',
      isAbnormal: false,
      testDate,
    },
  ]);

  await db.insert(schema.glucoseLogs).values([
    { userId, valueMgDl: 168, originalText: 'sugar 168', originalUnit: 'mg_dl', source: 'typed', alertLevel: 'none', loggedAt: new Date(now - 3 * DAY) },
    { userId, valueMgDl: 142, originalText: 'sugar ek sau bayaalees', originalUnit: 'mg_dl', source: 'voice', alertLevel: 'none', loggedAt: new Date(now - 2 * DAY) },
    { userId, valueMgDl: 196, originalText: 'شوگر ۱۹۶', originalUnit: 'mg_dl', source: 'typed', alertLevel: 'none', loggedAt: new Date(now - 1 * DAY) },
  ]);

  console.log(`Seeded Ramzan demo patient: ${userId}`);

  if (withPlan) {
    const { computeRisk, estimatedRamadan, savePlan, saveRisk } = await import('../src/services/ramadan/plan');
    const { createPlanSheetLink } = await import('../src/services/ramadan/plan-sheet');

    const dates = estimatedRamadan();
    if (!dates) throw new Error('No estimated Ramzan dates; pass a newer estimate in plan.ts.');

    const plan = await savePlan(userId, {
      ramadanStart: dates.start,
      ramadanEnd: dates.end,
      intendsToFast: true,
      city: 'karachi',
    });
    // Saves what the record answers; the always-asked items are left for the demo.
    await saveRisk(userId, plan.id, await computeRisk(userId, plan));
    const link = await createPlanSheetLink(userId, plan.id, 24 * 7);
    console.log(`Plan for Ramzan ${plan.year} in Karachi. Doctor sheet: ${link.url}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
