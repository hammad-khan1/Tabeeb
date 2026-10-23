/**
 * Due date, current week and the antenatal visit schedule. Pure functions on calendar
 * days ("YYYY-MM-DD"), so the server's time zone can never move a visit by a day.
 *
 * Sources:
 * - Due date: Naegele's rule, 280 days (40 weeks) from the first day of the last
 *   menstrual period (LMP).
 * - Visits: WHO recommendations on antenatal care for a positive pregnancy experience
 *   (2016) — eight contacts: one in the first 12 weeks, then at 20, 26, 30, 34, 36, 38
 *   and 40 weeks.
 */

export const PREGNANCY_DAYS = 280;

/** Postnatal care, and its danger signs, cover the six weeks after birth. */
export const POSTNATAL_DAYS = 42;

/** When to send the visit reminder. */
export const REMINDER_DAYS_BEFORE = 3;

/** A visit is "due" from a week before its planned week until two weeks after. */
const DUE_FROM_DAYS_BEFORE = 7;
const MISSED_AFTER_DAYS = 14;

/**
 * The birth-preparedness checklist appears two weeks before the 36-week contact, where
 * WHO places planning the birth, so the family has time to arrange it.
 */
export const BIRTH_PLAN_FROM_WEEK = 34;

export interface AncContactPlan {
  number: number;
  /** For contact 1 this is the latest week; the others are target weeks. */
  week: number;
  purpose: { en: string; ur: string; roman: string };
}

export const ANC_CONTACTS: readonly AncContactPlan[] = [
  {
    number: 1,
    week: 12,
    purpose: {
      en: 'First visit: blood tests, start iron and folic acid',
      ur: 'پہلا معائنہ: خون کے ٹیسٹ، آئرن اور فولک ایسڈ شروع',
      roman: 'Pehla muaina: khoon ke test, iron aur folic acid shuru',
    },
  },
  {
    number: 2,
    week: 20,
    purpose: {
      en: 'Check-up and ultrasound (recommended once before 24 weeks)',
      ur: 'معائنہ اور الٹراساؤنڈ (24 ہفتوں سے پہلے ایک بار)',
      roman: 'Muaina aur ultrasound (24 hafton se pehle aik baar)',
    },
  },
  { number: 3, week: 26, purpose: { en: 'Blood pressure and growth check', ur: 'بلڈ پریشر اور بچے کی نشوونما کا معائنہ', roman: 'BP aur bachay ki growth ka muaina' } },
  { number: 4, week: 30, purpose: { en: 'Blood pressure and growth check', ur: 'بلڈ پریشر اور بچے کی نشوونما کا معائنہ', roman: 'BP aur bachay ki growth ka muaina' } },
  { number: 5, week: 34, purpose: { en: 'Blood pressure and growth check', ur: 'بلڈ پریشر اور بچے کی نشوونما کا معائنہ', roman: 'BP aur bachay ki growth ka muaina' } },
  { number: 6, week: 36, purpose: { en: 'Plan where to deliver', ur: 'ڈیلیوری کی جگہ طے کریں', roman: 'Delivery ki jagah tay karein' } },
  { number: 7, week: 38, purpose: { en: 'Check-up', ur: 'معائنہ', roman: 'Muaina' } },
  { number: 8, week: 40, purpose: { en: 'Check-up, delivery is near', ur: 'معائنہ، ڈیلیوری قریب ہے', roman: 'Muaina, delivery qareeb hai' } },
];

// ── Calendar days ───────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(day: string): number {
  if (!ISO_DAY.test(day)) throw new RangeError(`Expected YYYY-MM-DD, got "${day}"`);
  const time = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new RangeError(`Not a calendar date: "${day}"`);
  }
  return time;
}

export function addDays(day: string, days: number): string {
  return new Date(toUtc(day) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

// ── Dates and weeks ─────────────────────────────────────────────────────────

export function dueDateFromLmp(lmp: string): string {
  return addDays(lmp, PREGNANCY_DAYS);
}

export function lmpFromDueDate(dueDate: string): string {
  return addDays(dueDate, -PREGNANCY_DAYS);
}

export interface GestationalAge {
  weeks: number;
  days: number;
  totalDays: number;
}

export function gestationalAge(lmp: string, today: string): GestationalAge {
  const totalDays = daysBetween(lmp, today);
  return { weeks: Math.floor(totalDays / 7), days: ((totalDays % 7) + 7) % 7, totalDays };
}

export type DateCheck = { ok: true } | { ok: false; reason: 'in_future' | 'too_long_ago' | 'too_far_ahead' | 'already_passed' };

/** An LMP must be in the past, and recent enough to be this pregnancy (under 44 weeks). */
export function checkLmp(lmp: string, today: string): DateCheck {
  const days = daysBetween(lmp, today);
  if (days < 0) return { ok: false, reason: 'in_future' };
  if (days > 44 * 7) return { ok: false, reason: 'too_long_ago' };
  return { ok: true };
}

/** A due date may be up to four weeks past (she may not have delivered) and at most 42 weeks ahead. */
export function checkDueDate(dueDate: string, today: string): DateCheck {
  const days = daysBetween(today, dueDate);
  if (days < -28) return { ok: false, reason: 'already_passed' };
  if (days > 42 * 7) return { ok: false, reason: 'too_far_ahead' };
  return { ok: true };
}

// ── Visits ──────────────────────────────────────────────────────────────────

export type ContactStatus = 'done' | 'due' | 'upcoming' | 'missed';

export function contactDate(lmp: string, week: number): string {
  return addDays(lmp, week * 7);
}

/**
 * Contact 1 is "by 12 weeks", so it is due from the start; every other contact is due
 * in the week before its target week and for two weeks after it.
 */
export function contactStatus(
  contact: { number: number; week: number; doneOn: string | null },
  lmp: string,
  today: string
): ContactStatus {
  if (contact.doneOn) return 'done';
  const target = contactDate(lmp, contact.week);
  const dueFrom = contact.number === 1 ? lmp : addDays(target, -DUE_FROM_DAYS_BEFORE);
  const missedAfter = addDays(target, contact.number === 1 ? 0 : MISSED_AFTER_DAYS);

  if (today < dueFrom) return 'upcoming';
  if (today > missedAfter) return 'missed';
  return 'due';
}

export interface ScheduledContact extends AncContactPlan {
  date: string;
  doneOn: string | null;
  status: ContactStatus;
}

export function buildSchedule(
  lmp: string,
  today: string,
  done: ReadonlyMap<number, string | null> = new Map()
): ScheduledContact[] {
  return ANC_CONTACTS.map((plan) => {
    const doneOn = done.get(plan.number) ?? null;
    return {
      ...plan,
      date: contactDate(lmp, plan.week),
      doneOn,
      status: contactStatus({ ...plan, doneOn }, lmp, today),
    };
  });
}

/** The visit to show next: the earliest one not done and not yet missed. */
export function nextContact(schedule: readonly ScheduledContact[]): ScheduledContact | null {
  return schedule.find((contact) => contact.status === 'due' || contact.status === 'upcoming') ?? null;
}

export function reminderDue(contact: ScheduledContact, today: string): boolean {
  if (contact.status === 'done' || contact.status === 'missed') return false;
  const days = daysBetween(today, contact.date);
  return days >= 0 && days <= REMINDER_DAYS_BEFORE;
}

/**
 * The reminder the family receives, naming her so it reaches whoever arranges the
 * transport and the money: "Kal Fatima ka 30 hafte ka checkup hai."
 */
export function visitReminderText(motherName: string, week: number, daysUntil: number) {
  const when =
    daysUntil <= 0
      ? { ur: 'آج', roman: 'Aaj', en: 'Today' }
      : daysUntil === 1
        ? { ur: 'کل', roman: 'Kal', en: 'Tomorrow' }
        : { ur: `${daysUntil} دن بعد`, roman: `${daysUntil} din baad`, en: `In ${daysUntil} days` };

  return {
    ur: `${when.ur} ${motherName} کا ${week} ہفتے کا چیک اپ ہے۔`,
    roman: `${when.roman} ${motherName} ka ${week} hafte ka checkup hai.`,
    en: `${when.en}: ${motherName}'s ${week}-week check-up.`,
  };
}

// ── Phase ───────────────────────────────────────────────────────────────────

export type Phase = 'antenatal' | 'postnatal' | 'ended';

export function phaseOf(
  pregnancy: { status: 'active' | 'delivered' | 'ended'; deliveredOn: string | null },
  today: string
): Phase {
  if (pregnancy.status === 'ended') return 'ended';
  if (pregnancy.status === 'delivered') {
    if (!pregnancy.deliveredOn) return 'postnatal';
    return daysBetween(pregnancy.deliveredOn, today) <= POSTNATAL_DAYS ? 'postnatal' : 'ended';
  }
  return 'antenatal';
}
