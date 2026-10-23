/**
 * Iron and folic acid, and tetanus (TT/Td) doses. Pure.
 *
 * The app tracks whether she took the tablet and which injections are still due. It
 * never chooses a dose: the tablet and the injection come from her doctor or Lady
 * Health Worker.
 *
 * Sources: WHO recommendations on antenatal care for a positive pregnancy experience
 * (2016) — daily oral iron 30–60 mg and folic acid 400 µg; tetanus toxoid vaccination
 * depending on previous exposure. Tetanus schedule: WHO position paper on tetanus
 * vaccines (2017) — dose 2 at least 4 weeks after dose 1, dose 3 at least 6 months after
 * dose 2, doses 4 and 5 at least a year after the one before; five doses protect for
 * the reproductive years.
 *
 * To be reviewed by a doctor before release.
 */

import { addDays, daysBetween } from './timeline';

export const IRON_FOLIC_GUIDANCE = {
  en: 'WHO recommends one tablet a day with 30–60 mg iron and 400 µg folic acid through pregnancy. Take the tablet your doctor or Lady Health Worker gives you.',
  ur: 'عالمی ادارہ صحت روزانہ ایک گولی کا مشورہ دیتا ہے جس میں 30 سے 60 ملی گرام آئرن اور 400 مائیکروگرام فولک ایسڈ ہو۔ وہی گولی لیں جو آپ کا ڈاکٹر یا لیڈی ہیلتھ ورکر دے۔',
  roman: 'WHO rozana aik goli ka mashwara deta hai jis mein 30–60 mg iron aur 400 µg folic acid ho. Wohi goli lein jo aap ka doctor ya Lady Health Worker de.',
} as const;

export const TT_GUIDANCE = {
  en: 'The tetanus injection protects your baby from newborn tetanus. Ask your health worker for the doses shown as due.',
  ur: 'ٹیٹنس کا ٹیکہ آپ کے بچے کو نومولود کے ٹیٹنس سے بچاتا ہے۔ جو خوراک باقی ہے وہ اپنے ہیلتھ ورکر سے لگوائیں۔',
  roman: 'Tetanus ka teeka aap ke bachay ko naumolood ke tetanus se bachata hai. Jo khurak baqi hai woh apne health worker se lagwayein.',
} as const;

// ── Iron and folic acid ─────────────────────────────────────────────────────

export interface IronSummary {
  takenToday: boolean;
  /** Consecutive days up to today, or up to yesterday if today is not logged yet. */
  streak: number;
  totalDays: number;
}

export function ironSummary(takenDays: readonly string[], today: string): IronSummary {
  const days = new Set(takenDays.filter((day) => day <= today));
  const takenToday = days.has(today);

  let streak = 0;
  let cursor = takenToday ? today : addDays(today, -1);
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return { takenToday, streak, totalDays: days.size };
}

// ── Tetanus ─────────────────────────────────────────────────────────────────

export const TT_FULL_COURSE = 5;

/** Minimum days after the previous dose, by dose number. */
const TT_MIN_INTERVAL_DAYS: Record<number, number> = { 2: 28, 3: 183, 4: 365, 5: 365 };

export type TtDoseStatus = 'given' | 'due' | 'later';

export interface TtDose {
  number: number;
  status: TtDoseStatus;
  givenOn: string | null;
  /** Earliest day it can be given, once the dose before it is logged. */
  earliest: string | null;
}

/**
 * The doses for this pregnancy. With no doses before (or unknown, which WHO treats as
 * none), she needs two, four weeks apart; with one to four before, the next one; with
 * five, she is protected and needs none. Doses from before this pregnancy have no dates
 * here, so the first dose of this pregnancy is always due straight away.
 */
export function ttPlan(dosesBefore: number | null, givenThisPregnancy: readonly string[], today: string): TtDose[] {
  const before = Math.min(Math.max(dosesBefore ?? 0, 0), TT_FULL_COURSE);
  if (before >= TT_FULL_COURSE) return [];

  const needed = before === 0 ? [1, 2] : [before + 1];
  const given = [...givenThisPregnancy].sort();

  // The date of the dose before, when it was given in this pregnancy. A dose waiting on
  // one not yet given has no earliest date.
  let previous: string | null = null;
  return needed.map((number, index): TtDose => {
    const givenOn = given[index] ?? null;
    if (givenOn) {
      previous = givenOn;
      return { number, status: 'given', givenOn, earliest: null };
    }

    let earliest: string | null = null;
    if (index === 0) earliest = today;
    else if (previous) earliest = addDays(previous, TT_MIN_INTERVAL_DAYS[number] ?? 28);
    previous = null;

    const status: TtDoseStatus = earliest !== null && daysBetween(earliest, today) >= 0 ? 'due' : 'later';
    return { number, status, givenOn: null, earliest };
  });
}

// ── Haemoglobin ─────────────────────────────────────────────────────────────

/**
 * "Keeps falling": each of the last three readings lower than the one before. The
 * shared trend analyzer calls a change under 0.5% of the mean per day "stable", which a
 * pregnancy Hb sliding 1.5 g/dL over three months never reaches, so this is checked
 * directly. It flags a pattern to show the doctor; it does not say she is anaemic.
 */
export function hbKeepsFalling(readingsOldestFirst: readonly number[]): boolean {
  const last = readingsOldestFirst.slice(-3);
  return last.length === 3 && last[1] < last[0] && last[2] < last[1];
}
