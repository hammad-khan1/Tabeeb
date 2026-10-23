/**
 * Turning individual reminders off. Reminders are worked out fresh each day from the
 * plan and prayer times; ramadan_reminders only records the ones the patient has
 * switched off (or back on), so a new day's schedule cannot resurrect them.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notFound } from '@/lib/api-error';
import { medications, ramadanReminders } from '../../../drizzle/schema';
import type { ReminderKind, RamadanSlot, ScheduledReminder } from './schedule';

export interface ReminderKey {
  kind: ReminderKind;
  slot: RamadanSlot;
  medicationId: string | null;
}

function keyOf(reminder: ReminderKey): string {
  return `${reminder.kind}:${reminder.slot}:${reminder.medicationId ?? ''}`;
}

export async function setReminderActive(
  userId: string,
  planId: string,
  reminder: ReminderKey & { label: string },
  active: boolean
): Promise<void> {
  const db = getDb();

  if (reminder.medicationId) {
    const [medicine] = await db
      .select({ id: medications.id })
      .from(medications)
      .where(and(eq(medications.id, reminder.medicationId), eq(medications.userId, userId)))
      .limit(1);
    if (!medicine) throw notFound('Medicine not found.');
  }

  const match = and(
    eq(ramadanReminders.userId, userId),
    eq(ramadanReminders.planId, planId),
    eq(ramadanReminders.kind, reminder.kind),
    eq(ramadanReminders.slot, reminder.slot),
    reminder.medicationId
      ? eq(ramadanReminders.medicationId, reminder.medicationId)
      : isNull(ramadanReminders.medicationId)
  );

  const [existing] = await db.select({ id: ramadanReminders.id }).from(ramadanReminders).where(match).limit(1);
  if (existing) {
    await db.update(ramadanReminders).set({ active }).where(eq(ramadanReminders.id, existing.id));
    return;
  }

  await db.insert(ramadanReminders).values({
    userId,
    planId,
    kind: reminder.kind,
    slot: reminder.slot,
    medicationId: reminder.medicationId,
    label: reminder.label.slice(0, 500),
    active,
  });
}

/** Marks each of the day's reminders on or off from the patient's saved choices. */
export async function applyReminderSettings(
  userId: string,
  planId: string,
  reminders: ScheduledReminder[]
): Promise<Array<ScheduledReminder & { active: boolean }>> {
  const rows = await getDb()
    .select({
      kind: ramadanReminders.kind,
      slot: ramadanReminders.slot,
      medicationId: ramadanReminders.medicationId,
      active: ramadanReminders.active,
    })
    .from(ramadanReminders)
    .where(and(eq(ramadanReminders.userId, userId), eq(ramadanReminders.planId, planId)));

  const settings = new Map(rows.map((row) => [keyOf(row), row.active]));
  return reminders.map((reminder) => ({
    ...reminder,
    active: settings.get(keyOf({ ...reminder, medicationId: reminder.medicationId ?? null })) ?? true,
  }));
}
