/**
 * Mother-care records: the pregnancy, its visits, tablets, readings, the family she
 * chose to inform, and danger events. Every query is scoped by the account, and every
 * write to a child row first checks the pregnancy belongs to that account.
 *
 * The account may be her husband's or another relative's, so lab results are read only
 * from documents she linked to this pregnancy — never from the rest of the account,
 * which would mix in someone else's record.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { getDb } from '@/lib/db';
import { badRequest, notFound } from '@/lib/api-error';
import {
  ancContacts,
  bpReadings,
  dangerEvents,
  documents,
  labResults,
  pregnancies,
  pregnancyCaregivers,
  pregnancyDocuments,
  shareLinks,
  supplementLogs,
  type BirthPlan,
} from '../../../drizzle/schema';
import { createShareLink } from '../history/share';
import { notify } from '../notify';
import { localDate } from '../ramadan/prayer-times';
import {
  AUDIO_RECORDED,
  caregiverAlertText,
  findSign,
  GO_TO_HOSPITAL,
  signsFor,
  SIGN_CAN_BE_DANGEROUS,
  type DangerPhase,
} from './danger-signs';
import { readDueDates } from './due-date-reader';
import { hbKeepsFalling, ironSummary, ttPlan } from './supplements';
import {
  ANC_CONTACTS,
  BIRTH_PLAN_FROM_WEEK,
  buildSchedule,
  checkDueDate,
  checkLmp,
  daysBetween,
  dueDateFromLmp,
  gestationalAge,
  lmpFromDueDate,
  nextContact,
  phaseOf,
  reminderDue,
  visitReminderText,
} from './timeline';

export type Pregnancy = typeof pregnancies.$inferSelect;

/** An emergency summary link lives a day: long enough for the visit, not for ever. */
const EMERGENCY_LINK_HOURS = 24;

// ── Ownership ───────────────────────────────────────────────────────────────

export async function requirePregnancy(userId: string, pregnancyId: string): Promise<Pregnancy> {
  const [row] = await getDb()
    .select()
    .from(pregnancies)
    .where(and(eq(pregnancies.id, pregnancyId), eq(pregnancies.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Pregnancy record not found.');
  return row;
}

async function requireDocument(userId: string, documentId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Document not found.');
}

/**
 * Due dates found in an uploaded ultrasound report's text, for the family to confirm.
 * Only plausible dates are offered; nothing is saved here.
 */
export async function readDueDateFromDocument(userId: string, documentId: string, today: string = localDate()) {
  const [document] = await getDb()
    .select({ text: documents.rawExtractedText, status: documents.extractionStatus })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!document) throw notFound('Document not found.');

  return {
    stillReading: document.status === 'pending' || document.status === 'processing',
    candidates: readDueDates(document.text ?? '').filter((candidate) => checkDueDate(candidate.date, today).ok),
  };
}

// ── Create, list, update ────────────────────────────────────────────────────

export interface CreatePregnancyInput {
  motherName: string;
  enteredBy: 'self' | 'family';
  consentConfirmed: boolean;
  lmpDate?: string;
  dueDate?: string;
  dueDateDocumentId?: string;
  bloodGroup?: string | null;
  ttDosesBefore?: number | null;
  pastComplications?: string[];
}

const DATE_PROBLEM: Record<string, string> = {
  in_future: 'The last period date cannot be in the future.',
  too_long_ago: 'That last period date is more than 44 weeks ago.',
  already_passed: 'That due date passed more than four weeks ago.',
  too_far_ahead: 'That due date is more than 42 weeks away.',
};

export async function createPregnancy(
  userId: string,
  input: CreatePregnancyInput,
  today: string = localDate()
): Promise<Pregnancy> {
  // A record kept by a family member exists only with her agreement.
  if (input.enteredBy === 'family' && !input.consentConfirmed) {
    throw badRequest(`Please confirm that ${input.motherName} has agreed to keep this record here.`);
  }

  let lmp: string;
  let due: string;
  if (input.lmpDate) {
    const check = checkLmp(input.lmpDate, today);
    if (!check.ok) throw badRequest(DATE_PROBLEM[check.reason]);
    lmp = input.lmpDate;
    due = dueDateFromLmp(lmp);
  } else if (input.dueDate) {
    const check = checkDueDate(input.dueDate, today);
    if (!check.ok) throw badRequest(DATE_PROBLEM[check.reason]);
    due = input.dueDate;
    lmp = lmpFromDueDate(due);
  } else {
    throw badRequest('Enter the last period date or the due date.');
  }

  if (input.dueDateDocumentId) await requireDocument(userId, input.dueDateDocumentId);

  return getDb().transaction(async (tx) => {
    const [pregnancy] = await tx
      .insert(pregnancies)
      .values({
        userId,
        motherName: input.motherName,
        enteredBy: input.enteredBy,
        consentConfirmed: input.enteredBy === 'self' || input.consentConfirmed,
        lmpDate: lmp,
        dueDate: due,
        dueDateSource: input.lmpDate ? 'lmp' : input.dueDateDocumentId ? 'ultrasound_report' : 'due_date',
        dueDateDocumentId: input.dueDateDocumentId ?? null,
        bloodGroup: input.bloodGroup ?? null,
        ttDosesBefore: input.ttDosesBefore ?? null,
        pastComplications: input.pastComplications ?? [],
      })
      .returning();

    await tx.insert(ancContacts).values(
      ANC_CONTACTS.map((contact) => ({
        pregnancyId: pregnancy.id,
        userId,
        contactNumber: contact.number,
        plannedWeek: contact.week,
      }))
    );

    if (input.dueDateDocumentId) {
      await tx.insert(pregnancyDocuments).values({ pregnancyId: pregnancy.id, userId, documentId: input.dueDateDocumentId });
    }
    return pregnancy;
  });
}

export async function listPregnancies(userId: string) {
  return getDb()
    .select({
      id: pregnancies.id,
      motherName: pregnancies.motherName,
      dueDate: pregnancies.dueDate,
      status: pregnancies.status,
      deliveredOn: pregnancies.deliveredOn,
    })
    .from(pregnancies)
    .where(eq(pregnancies.userId, userId))
    .orderBy(desc(pregnancies.createdAt))
    .limit(20);
}

export interface UpdatePregnancyInput {
  bloodGroup?: string | null;
  ttDosesBefore?: number | null;
  pastComplications?: string[];
  birthPlan?: BirthPlan;
  /** Records the birth; the timeline moves to postnatal care. */
  deliveredOn?: string;
  /** Ends the record without a birth, or after the postnatal weeks. */
  ended?: true;
}

export async function updatePregnancy(
  userId: string,
  pregnancyId: string,
  input: UpdatePregnancyInput,
  today: string = localDate()
): Promise<Pregnancy> {
  const current = await requirePregnancy(userId, pregnancyId);

  if (input.deliveredOn && (input.deliveredOn > today || (current.lmpDate && input.deliveredOn < current.lmpDate))) {
    throw badRequest('The date of birth must be during this pregnancy and not in the future.');
  }

  const [updated] = await getDb()
    .update(pregnancies)
    .set({
      ...(input.bloodGroup !== undefined ? { bloodGroup: input.bloodGroup } : {}),
      ...(input.ttDosesBefore !== undefined ? { ttDosesBefore: input.ttDosesBefore } : {}),
      ...(input.pastComplications !== undefined ? { pastComplications: input.pastComplications } : {}),
      ...(input.birthPlan !== undefined ? { birthPlan: { ...(current.birthPlan ?? {}), ...input.birthPlan } } : {}),
      ...(input.deliveredOn ? { status: 'delivered' as const, deliveredOn: input.deliveredOn } : {}),
      ...(input.ended ? { status: 'ended' as const } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(pregnancies.id, pregnancyId), eq(pregnancies.userId, userId)))
    .returning();
  return updated;
}

/** Her record is hers to remove; cascades take every visit, log and link with it. */
export async function deletePregnancy(userId: string, pregnancyId: string): Promise<void> {
  const [deleted] = await getDb()
    .delete(pregnancies)
    .where(and(eq(pregnancies.id, pregnancyId), eq(pregnancies.userId, userId)))
    .returning({ id: pregnancies.id });
  if (!deleted) throw notFound('Pregnancy record not found.');
}

// ── Visits and documents ────────────────────────────────────────────────────

export async function updateContact(
  userId: string,
  pregnancyId: string,
  contactNumber: number,
  input: { doneOn?: string | null; documentId?: string | null },
  today: string = localDate()
): Promise<void> {
  await requirePregnancy(userId, pregnancyId);
  if (input.doneOn && input.doneOn > today) throw badRequest('A visit cannot be marked done in the future.');
  if (input.documentId) await requireDocument(userId, input.documentId);

  const [updated] = await getDb()
    .update(ancContacts)
    .set({
      ...(input.doneOn !== undefined ? { doneOn: input.doneOn } : {}),
      ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
    })
    .where(
      and(
        eq(ancContacts.pregnancyId, pregnancyId),
        eq(ancContacts.userId, userId),
        eq(ancContacts.contactNumber, contactNumber)
      )
    )
    .returning({ id: ancContacts.id });
  if (!updated) throw notFound('Visit not found.');

  // Visit notes count as linked documents, so their lab results reach the Hb history.
  if (input.documentId) await linkDocument(userId, pregnancyId, input.documentId);
}

export async function linkDocument(userId: string, pregnancyId: string, documentId: string): Promise<void> {
  await requirePregnancy(userId, pregnancyId);
  await requireDocument(userId, documentId);
  await getDb().insert(pregnancyDocuments).values({ pregnancyId, userId, documentId }).onConflictDoNothing();
}

export async function unlinkDocument(userId: string, pregnancyId: string, documentId: string): Promise<void> {
  await requirePregnancy(userId, pregnancyId);
  await getDb()
    .delete(pregnancyDocuments)
    .where(
      and(
        eq(pregnancyDocuments.pregnancyId, pregnancyId),
        eq(pregnancyDocuments.userId, userId),
        eq(pregnancyDocuments.documentId, documentId)
      )
    );
}

async function linkedDocumentIds(userId: string, pregnancyId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ documentId: pregnancyDocuments.documentId })
    .from(pregnancyDocuments)
    .where(and(eq(pregnancyDocuments.pregnancyId, pregnancyId), eq(pregnancyDocuments.userId, userId)));
  return rows.map((row) => row.documentId);
}

// ── Tablets, injections, blood pressure ─────────────────────────────────────

export async function logSupplement(
  userId: string,
  pregnancyId: string,
  kind: 'iron_folic' | 'tt_dose',
  day: string,
  today: string = localDate()
): Promise<void> {
  await requirePregnancy(userId, pregnancyId);
  if (day > today) throw badRequest('That day has not happened yet.');
  await getDb().insert(supplementLogs).values({ pregnancyId, userId, kind, takenOn: day }).onConflictDoNothing();
}

export async function removeSupplement(
  userId: string,
  pregnancyId: string,
  kind: 'iron_folic' | 'tt_dose',
  day: string
): Promise<void> {
  await getDb()
    .delete(supplementLogs)
    .where(
      and(
        eq(supplementLogs.pregnancyId, pregnancyId),
        eq(supplementLogs.userId, userId),
        eq(supplementLogs.kind, kind),
        eq(supplementLogs.takenOn, day)
      )
    );
}

export async function addBpReading(userId: string, pregnancyId: string, systolic: number, diastolic: number) {
  await requirePregnancy(userId, pregnancyId);
  if (diastolic >= systolic) throw badRequest('The top number (systolic) should be higher than the bottom one.');
  const [row] = await getDb().insert(bpReadings).values({ pregnancyId, userId, systolic, diastolic }).returning();
  return row;
}

// ── Family ──────────────────────────────────────────────────────────────────

export interface CaregiverInput {
  name: string;
  relation?: string | null;
  phone: string;
  receivesReminders?: boolean;
  receivesAlerts?: boolean;
}

export async function addCaregiver(userId: string, pregnancyId: string, input: CaregiverInput) {
  await requirePregnancy(userId, pregnancyId);
  const [row] = await getDb()
    .insert(pregnancyCaregivers)
    .values({
      pregnancyId,
      userId,
      name: input.name,
      relation: input.relation ?? null,
      phone: input.phone,
      receivesReminders: input.receivesReminders ?? true,
      receivesAlerts: input.receivesAlerts ?? true,
    })
    .returning();
  return row;
}

export async function updateCaregiver(
  userId: string,
  pregnancyId: string,
  caregiverId: string,
  input: Partial<CaregiverInput>
) {
  const [row] = await getDb()
    .update(pregnancyCaregivers)
    .set(input)
    .where(
      and(
        eq(pregnancyCaregivers.id, caregiverId),
        eq(pregnancyCaregivers.pregnancyId, pregnancyId),
        eq(pregnancyCaregivers.userId, userId)
      )
    )
    .returning();
  if (!row) throw notFound('Family member not found.');
  return row;
}

export async function removeCaregiver(userId: string, pregnancyId: string, caregiverId: string): Promise<void> {
  const [row] = await getDb()
    .delete(pregnancyCaregivers)
    .where(
      and(
        eq(pregnancyCaregivers.id, caregiverId),
        eq(pregnancyCaregivers.pregnancyId, pregnancyId),
        eq(pregnancyCaregivers.userId, userId)
      )
    )
    .returning({ id: pregnancyCaregivers.id });
  if (!row) throw notFound('Family member not found.');
}

// ── Reading it all back ─────────────────────────────────────────────────────

async function hbHistory(userId: string, documentIds: string[]) {
  if (documentIds.length === 0) return { readings: [], falling: false };

  const rows = await getDb()
    .select({
      value: labResults.canonicalValue,
      unit: labResults.canonicalUnit,
      testDate: labResults.testDate,
      referenceRange: labResults.referenceRange,
    })
    .from(labResults)
    .where(
      and(
        eq(labResults.userId, userId),
        eq(labResults.canonicalTestName, 'hemoglobin'),
        inArray(labResults.documentId, documentIds)
      )
    )
    .orderBy(labResults.testDate)
    .limit(50);

  const readings = rows.filter((row): row is typeof row & { value: number } => row.value !== null);
  return { readings, falling: hbKeepsFalling(readings.map((row) => row.value)) };
}

async function children(userId: string, pregnancyId: string) {
  const db = getDb();
  const [contacts, supplements, bp, caregivers, events, documentIds] = await Promise.all([
    db
      .select()
      .from(ancContacts)
      .where(and(eq(ancContacts.pregnancyId, pregnancyId), eq(ancContacts.userId, userId)))
      .orderBy(ancContacts.contactNumber),
    db
      .select({ kind: supplementLogs.kind, takenOn: supplementLogs.takenOn })
      .from(supplementLogs)
      .where(and(eq(supplementLogs.pregnancyId, pregnancyId), eq(supplementLogs.userId, userId))),
    db
      .select({ systolic: bpReadings.systolic, diastolic: bpReadings.diastolic, measuredAt: bpReadings.measuredAt })
      .from(bpReadings)
      .where(and(eq(bpReadings.pregnancyId, pregnancyId), eq(bpReadings.userId, userId)))
      .orderBy(desc(bpReadings.measuredAt))
      .limit(20),
    db
      .select()
      .from(pregnancyCaregivers)
      .where(and(eq(pregnancyCaregivers.pregnancyId, pregnancyId), eq(pregnancyCaregivers.userId, userId)))
      .orderBy(pregnancyCaregivers.createdAt),
    db
      .select({ sign: dangerEvents.sign, phase: dangerEvents.phase, createdAt: dangerEvents.createdAt })
      .from(dangerEvents)
      .where(and(eq(dangerEvents.pregnancyId, pregnancyId), eq(dangerEvents.userId, userId)))
      .orderBy(desc(dangerEvents.createdAt))
      .limit(10),
    linkedDocumentIds(userId, pregnancyId),
  ]);
  return { contacts, supplements, bp, caregivers, events, documentIds };
}

/** Everything the Mother-care screen shows for one pregnancy. */
export async function getPregnancyView(userId: string, pregnancyId: string, today: string = localDate()) {
  const pregnancy = await requirePregnancy(userId, pregnancyId);
  const lmp = pregnancy.lmpDate ?? lmpFromDueDate(pregnancy.dueDate);
  const { contacts, supplements, bp, caregivers, events, documentIds } = await children(userId, pregnancyId);

  const schedule = buildSchedule(lmp, today, new Map(contacts.map((c) => [c.contactNumber, c.doneOn])));
  const next = nextContact(schedule);
  const phase = phaseOf(pregnancy, today);
  const age = gestationalAge(lmp, today);
  const dangerPhase: DangerPhase = phase === 'antenatal' ? 'antenatal' : 'postnatal';

  const linkedDocuments =
    documentIds.length > 0
      ? await getDb()
          .select({ id: documents.id, title: documents.title, documentType: documents.documentType, documentDate: documents.documentDate })
          .from(documents)
          .where(and(eq(documents.userId, userId), inArray(documents.id, documentIds)))
      : [];

  return {
    pregnancy,
    phase,
    gestationalAge: age,
    daysToDue: daysBetween(today, pregnancy.dueDate),
    schedule: schedule.map((contact) => ({
      ...contact,
      documentId: contacts.find((row) => row.contactNumber === contact.number)?.documentId ?? null,
    })),
    nextContact: next,
    reminder:
      next && reminderDue(next, today)
        ? visitReminderText(pregnancy.motherName, next.week, daysBetween(today, next.date))
        : null,
    iron: ironSummary(
      supplements.filter((log) => log.kind === 'iron_folic').map((log) => log.takenOn),
      today
    ),
    tetanus: ttPlan(
      pregnancy.ttDosesBefore,
      supplements.filter((log) => log.kind === 'tt_dose').map((log) => log.takenOn),
      today
    ),
    hb: await hbHistory(userId, documentIds),
    bp,
    caregivers,
    linkedDocuments,
    showBirthPlan: phase === 'antenatal' && age.weeks >= BIRTH_PLAN_FROM_WEEK,
    dangerSigns: signsFor(dangerPhase).map((sign) => ({ ...sign, audioRecorded: AUDIO_RECORDED.has(`${dangerPhase}-${sign.id}`) })),
    dangerPhase,
    recentDangerEvents: events,
  };
}

// ── Emergency ───────────────────────────────────────────────────────────────

async function emergencyLink(userId: string, pregnancy: Pregnancy) {
  const link = await createShareLink(userId, {
    title: `${pregnancy.motherName} — pregnancy emergency summary`,
    pregnancyId: pregnancy.id,
    expiresInHours: EMERGENCY_LINK_HOURS,
  });
  const qrSvg = await QRCode.toString(link.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { url: link.url, expiresAt: link.expiresAt, qrSvg };
}

export async function createEmergencySummaryLink(userId: string, pregnancyId: string) {
  return emergencyLink(userId, await requirePregnancy(userId, pregnancyId));
}

/**
 * "Mujhe yeh ho raha hai." Records the sign, tells every family member she chose to
 * alert, and opens her emergency summary as a QR code for the hospital. A sign from
 * either list is accepted: nothing about the timeline may block this.
 */
export async function reportDangerSign(userId: string, pregnancyId: string, signId: string, today: string = localDate()) {
  const pregnancy = await requirePregnancy(userId, pregnancyId);
  const phase: DangerPhase = phaseOf(pregnancy, today) === 'antenatal' ? 'antenatal' : 'postnatal';
  const other: DangerPhase = phase === 'antenatal' ? 'postnatal' : 'antenatal';
  const sign = findSign(phase, signId) ?? findSign(other, signId);
  if (!sign) throw badRequest('Unknown danger sign.');

  const [event] = await getDb()
    .insert(dangerEvents)
    .values({ pregnancyId, userId, sign: sign.id, phase })
    .returning({ id: dangerEvents.id });

  const caregivers = await getDb()
    .select()
    .from(pregnancyCaregivers)
    .where(
      and(
        eq(pregnancyCaregivers.pregnancyId, pregnancyId),
        eq(pregnancyCaregivers.userId, userId),
        eq(pregnancyCaregivers.receivesAlerts, true)
      )
    );

  const text = caregiverAlertText(pregnancy.motherName, sign.text);
  const results = await Promise.all(
    caregivers.map((caregiver) =>
      notify(userId, {
        kind: 'pregnancy_danger',
        recipient: 'caregiver',
        contact: { name: caregiver.name, phone: caregiver.phone },
        text,
      })
    )
  );
  const notified = results.filter(Boolean).length;
  await getDb().update(dangerEvents).set({ caregiversNotified: notified }).where(eq(dangerEvents.id, event.id));

  return {
    instruction: GO_TO_HOSPITAL,
    warning: SIGN_CAN_BE_DANGEROUS,
    sign,
    caregiversNotified: notified,
    caregiversWithAlerts: caregivers.length,
    emergency: await emergencyLink(userId, pregnancy),
  };
}

export interface EmergencySummary {
  motherName: string;
  phase: ReturnType<typeof phaseOf>;
  weeks: number | null;
  dueDate: string;
  deliveredOn: string | null;
  bloodGroup: string | null;
  pastComplications: string[];
  hb: Array<{ value: number; unit: string | null; testDate: Date }>;
  bp: Array<{ systolic: number; diastolic: number; measuredAt: Date }>;
  tetanus: ReturnType<typeof ttPlan>;
  ttDosesBefore: number | null;
  ironDaysTaken: number;
  recentDangerSigns: Array<{ text: string; at: Date }>;
  generatedAt: Date;
}

export async function buildEmergencySummary(
  userId: string,
  pregnancyId: string,
  today: string = localDate()
): Promise<EmergencySummary> {
  const pregnancy = await requirePregnancy(userId, pregnancyId);
  const lmp = pregnancy.lmpDate ?? lmpFromDueDate(pregnancy.dueDate);
  const { supplements, bp, events, documentIds } = await children(userId, pregnancyId);
  const phase = phaseOf(pregnancy, today);

  return {
    motherName: pregnancy.motherName,
    phase,
    weeks: phase === 'antenatal' ? gestationalAge(lmp, today).weeks : null,
    dueDate: pregnancy.dueDate,
    deliveredOn: pregnancy.deliveredOn,
    bloodGroup: pregnancy.bloodGroup,
    pastComplications: pregnancy.pastComplications ?? [],
    hb: (await hbHistory(userId, documentIds)).readings.map(({ value, unit, testDate }) => ({ value, unit, testDate })),
    bp,
    tetanus: ttPlan(
      pregnancy.ttDosesBefore,
      supplements.filter((log) => log.kind === 'tt_dose').map((log) => log.takenOn),
      today
    ),
    ttDosesBefore: pregnancy.ttDosesBefore,
    ironDaysTaken: supplements.filter((log) => log.kind === 'iron_folic').length,
    recentDangerSigns: events.map((event) => ({
      text: findSign(event.phase, event.sign)?.text.en ?? event.sign,
      at: event.createdAt,
    })),
    generatedAt: new Date(),
  };
}

/** Public: what /share/<token> shows for an emergency-summary link. */
export async function getSharedEmergencySummary(token: string) {
  const [link] = await getDb()
    .update(shareLinks)
    .set({ viewCount: sql`${shareLinks.viewCount} + 1` })
    .where(
      and(
        eq(shareLinks.token, token),
        eq(shareLinks.isActive, true),
        sql`${shareLinks.expiresAt} > now()`,
        sql`${shareLinks.pregnancyId} is not null`
      )
    )
    .returning();

  if (!link?.pregnancyId) {
    throw notFound('This link is no longer available. It may have expired or been revoked.');
  }
  return {
    expiresAt: link.expiresAt,
    summary: await buildEmergencySummary(link.userId, link.pregnancyId),
  };
}
