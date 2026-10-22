/**
 * One day's Ramzan reminders, on the Sehri/Iftar clock.
 *
 * Meal and glucose-check reminders always go on the clock. Medicines only do when a
 * doctor has written the Ramzan timing. Moving a dose from morning to Sehri or Iftar is
 * a clinical decision — a once-daily sulfonylurea moved to Sehri is the classic cause of
 * a hypoglycaemic afternoon — so without a doctor-confirmed plan every medicine is
 * listed as waiting for the doctor, and none is given a Ramzan time.
 */

import { POST_IFTAR_CHECK_MINUTES, PRE_IFTAR_CHECK_MINUTES } from './constants';
import { parseFrequency } from './frequency';
import type { FastingDay } from './prayer-times';

export type RamadanSlot = 'sehri' | 'midday' | 'pre_iftar' | 'iftar' | 'post_iftar' | 'bedtime';

export type ReminderKind = 'medicine' | 'glucose_check' | 'sehri' | 'iftar';

/** When to nudge, not clinical values — so these live here rather than constants.ts. */
const SEHRI_MEAL_LEAD_MINUTES = 45;
const BEDTIME_AFTER_ISHA_MINUTES = 60;

const MINUTE = 60_000;

export function slotTime(slot: RamadanSlot, day: FastingDay): Date {
  const fajr = day.sehriEnds.getTime();
  const maghrib = day.iftar.getTime();

  switch (slot) {
    case 'sehri':
      return new Date(fajr - SEHRI_MEAL_LEAD_MINUTES * MINUTE);
    case 'midday':
      return new Date(fajr + (maghrib - fajr) / 2);
    case 'pre_iftar':
      return new Date(maghrib - PRE_IFTAR_CHECK_MINUTES * MINUTE);
    case 'iftar':
      return new Date(maghrib);
    case 'post_iftar':
      return new Date(maghrib + POST_IFTAR_CHECK_MINUTES * MINUTE);
    case 'bedtime':
      return new Date(day.isha.getTime() + BEDTIME_AFTER_ISHA_MINUTES * MINUTE);
  }
}

export interface ScheduleMedicine {
  id: string;
  name: string;
  frequency: string | null;
}

export interface ScheduledReminder {
  kind: ReminderKind;
  slot: RamadanSlot;
  at: Date;
  label: string;
  medicationId?: string;
}

export type UnscheduledReason =
  /** No doctor-confirmed Ramzan plan yet. */
  | 'awaiting_doctor_plan'
  /** The doctor's plan names a time inside the fast (morning, afternoon, evening). */
  | 'falls_in_fast'
  /** The timing could not be read, or contradicts itself. */
  | 'timing_unclear';

export interface UnscheduledMedicine {
  medicationId: string;
  name: string;
  frequency: string | null;
  reason: UnscheduledReason;
}

export interface DaySchedule {
  date: string;
  sehriEnds: Date;
  iftar: Date;
  reminders: ScheduledReminder[];
  unscheduled: UnscheduledMedicine[];
  /** Show "Ask your doctor to adjust these for Ramzan". */
  askDoctor: boolean;
}

const FIXED_REMINDERS: ReadonlyArray<{ kind: ReminderKind; slot: RamadanSlot; label: string }> = [
  { kind: 'sehri', slot: 'sehri', label: 'Sehri' },
  { kind: 'glucose_check', slot: 'midday', label: 'Glucose check' },
  { kind: 'glucose_check', slot: 'pre_iftar', label: 'Glucose check' },
  { kind: 'iftar', slot: 'iftar', label: 'Iftar' },
  { kind: 'glucose_check', slot: 'post_iftar', label: 'Glucose check' },
];

/**
 * Ramzan slots for a medicine on a doctor's Ramzan plan, or why it has none. A medicine
 * with any dose that cannot be placed is left off the clock entirely: reminding for
 * one of its two doses would read as the whole instruction.
 */
function medicineSlots(frequency: string | null): RamadanSlot[] | UnscheduledReason {
  const parsed = parseFrequency(frequency);
  const slots: RamadanSlot[] = [...parsed.ramadanSlots];
  const daytime = parsed.dayParts.filter((part) => part !== 'night');

  if (daytime.length > 0) {
    return parsed.ramadanSlots.length > 0 ? 'timing_unclear' : 'falls_in_fast';
  }
  if (parsed.dayParts.includes('night')) slots.push('bedtime');

  return slots.length > 0 ? slots : 'timing_unclear';
}

export function buildDaySchedule(options: {
  day: FastingDay;
  medicines: readonly ScheduleMedicine[];
  doctorConfirmed: boolean;
}): DaySchedule {
  const { day, medicines, doctorConfirmed } = options;

  const reminders: ScheduledReminder[] = FIXED_REMINDERS.map((reminder) => ({
    ...reminder,
    at: slotTime(reminder.slot, day),
  }));
  const unscheduled: UnscheduledMedicine[] = [];

  for (const medicine of medicines) {
    const base = { medicationId: medicine.id, name: medicine.name, frequency: medicine.frequency };

    if (!doctorConfirmed) {
      unscheduled.push({ ...base, reason: 'awaiting_doctor_plan' });
      continue;
    }

    const slots = medicineSlots(medicine.frequency);
    if (!Array.isArray(slots)) {
      unscheduled.push({ ...base, reason: slots });
      continue;
    }

    for (const slot of slots) {
      reminders.push({
        kind: 'medicine',
        slot,
        at: slotTime(slot, day),
        label: medicine.name,
        medicationId: medicine.id,
      });
    }
  }

  // Stable: at the same minute, the meal reminder stays ahead of the medicines.
  reminders.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    date: day.date,
    sehriEnds: day.sehriEnds,
    iftar: day.iftar,
    reminders,
    unscheduled,
    askDoctor: unscheduled.length > 0,
  };
}
