/**
 * Today's Ramzan screen: Sehri and Iftar for the plan's place, the day's reminders,
 * and the latest readings.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { badRequest } from '@/lib/api-error';
import { medications } from '../../../drizzle/schema';
import { recentGlucoseLogs } from './glucose-log';
import type { RamadanPlan } from './plan';
import { fastingTimes, localDate } from './prayer-times';
import { applyReminderSettings } from './reminders';
import { buildDaySchedule, type ScheduleMedicine } from './schedule';

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export async function buildToday(userId: string, plan: RamadanPlan, now: Date = new Date()) {
  if (plan.latitude == null || plan.longitude == null) {
    throw badRequest('This plan has no location. Choose a city first.');
  }
  const location = { latitude: plan.latitude, longitude: plan.longitude };
  const date = localDate(now);
  const day = fastingTimes(date, location);

  // With a doctor's Ramzan prescription, its medicines are the schedule. Without one,
  // every active medicine is listed for the patient to take to their doctor.
  const fromDoctor = plan.doctorConfirmed && plan.doctorPlanDocumentId;
  const medicines: ScheduleMedicine[] = await getDb()
    .select({ id: medications.id, name: medications.name, frequency: medications.frequency })
    .from(medications)
    .where(
      and(
        eq(medications.userId, userId),
        eq(medications.isActive, true),
        fromDoctor ? eq(medications.documentId, plan.doctorPlanDocumentId!) : undefined
      )
    )
    .limit(60);

  const schedule = buildDaySchedule({ day, medicines, doctorConfirmed: Boolean(fromDoctor) });

  return {
    inRamadan: date >= plan.ramadanStart && date <= plan.ramadanEnd,
    city: plan.city,
    ...schedule,
    reminders: await applyReminderSettings(userId, plan.id, schedule.reminders),
    doctorPlanDocumentId: fromDoctor ? plan.doctorPlanDocumentId : null,
    // For the countdown after Iftar, which runs to tomorrow's Sehri.
    tomorrowSehriEnds: fastingTimes(nextDay(date), location).sehriEnds,
    readings: await recentGlucoseLogs(userId),
  };
}
