/**
 * Logging a reading: parse, check against the break-the-fast rules, store, and tell
 * the caregiver if the plan names one. Every query is scoped by user.
 */

import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { ApiError, notFound } from '@/lib/api-error';
import { glucoseLogs } from '../../../drizzle/schema';
import { parseGlucose, readingFromNumber, type GlucoseParseResult, type ReadingExtractor } from './glucose-parse';
import { alertMessage, evaluateReading, type AlertLevel, type AlertMessage, type GlucoseUnit, type Symptom } from './glucose-rules';
import { notify } from '../notify';
import type { RamadanPlan } from './plan';

export interface GlucoseLogInput {
  text?: string;
  value?: number;
  unit?: GlucoseUnit;
  symptoms: Symptom[];
  source: 'typed' | 'voice' | 'photo';
  confirmed: boolean;
}

export type GlucoseLogOutcome =
  | {
      status: 'logged';
      log: { id: string; valueMgDl: number | null; alertLevel: AlertLevel; loggedAt: Date };
      alert: AlertMessage | null;
      caregiverNotified: boolean;
    }
  | {
      /** Nothing stored yet: the patient must confirm the value first. */
      status: 'needs_confirmation';
      reading: Extract<GlucoseParseResult, { ok: true }>;
      /** What the alert will be if confirmed — shown now, so a low is not delayed. */
      provisionalAlert: AlertMessage | null;
    };

const UNREADABLE: Record<Exclude<GlucoseParseResult, { ok: true }>['reason'], string> = {
  no_number: 'No sugar reading found. Type the number from your meter.',
  multiple_numbers: 'More than one number found. Type only the reading from your meter.',
  ambiguous_unit: 'Is this mg/dL or mmol/L? Please choose the unit.',
  out_of_range: 'That number is outside what a glucometer shows. Please check the reading.',
};

export async function logGlucose(
  userId: string,
  plan: RamadanPlan | null,
  input: GlucoseLogInput,
  options: {
    extract?: ReadingExtractor;
    /** For values read by a model, such as a meter photo: always ask before storing. */
    alwaysConfirm?: boolean;
  } = {}
): Promise<GlucoseLogOutcome> {
  let reading: GlucoseParseResult | null = null;
  if (input.value !== undefined && input.unit !== undefined) {
    reading = readingFromNumber(input.value, input.unit);
  } else if (input.text) {
    reading = await parseGlucose(input.text, options.extract);
  }

  if (reading && !reading.ok && input.symptoms.length === 0) {
    // 422 with the reason, so the screen can ask exactly the right question.
    throw new ApiError(422, UNREADABLE[reading.reason]);
  }

  const parsed = reading?.ok ? reading : null;
  const level = evaluateReading({ valueMgDl: parsed?.valueMgDl ?? null, symptoms: input.symptoms });

  if (parsed && (parsed.needsConfirmation || options.alwaysConfirm) && !input.confirmed) {
    return { status: 'needs_confirmation', reading: parsed, provisionalAlert: alertMessage(level) };
  }

  const [log] = await getDb()
    .insert(glucoseLogs)
    .values({
      userId,
      planId: plan?.id ?? null,
      valueMgDl: parsed?.valueMgDl ?? null,
      originalText: input.text ?? (input.value !== undefined ? String(input.value) : null),
      originalUnit: parsed?.unit ?? null,
      source: input.source,
      symptoms: input.symptoms,
      alertLevel: level,
    })
    .returning({
      id: glucoseLogs.id,
      valueMgDl: glucoseLogs.valueMgDl,
      alertLevel: glucoseLogs.alertLevel,
      loggedAt: glucoseLogs.loggedAt,
    });

  const alert = alertMessage(level);
  let caregiverNotified = false;
  if (alert?.notifyCaregiver && plan?.caregiverPhone) {
    caregiverNotified = await notify(userId, {
      kind: 'glucose_alert',
      recipient: 'caregiver',
      contact: { name: plan.caregiverName, phone: plan.caregiverPhone },
      text: alert.action,
    });
  }

  return { status: 'logged', log, alert, caregiverNotified };
}

export async function markFastBroken(userId: string, logId: string): Promise<Date> {
  const [updated] = await getDb()
    .update(glucoseLogs)
    .set({ fastBrokenAt: new Date() })
    .where(and(eq(glucoseLogs.id, logId), eq(glucoseLogs.userId, userId)))
    .returning({ fastBrokenAt: glucoseLogs.fastBrokenAt });

  if (!updated?.fastBrokenAt) throw notFound('Reading not found.');
  return updated.fastBrokenAt;
}

export async function recentGlucoseLogs(userId: string, limit = 5) {
  return getDb()
    .select({
      id: glucoseLogs.id,
      valueMgDl: glucoseLogs.valueMgDl,
      symptoms: glucoseLogs.symptoms,
      alertLevel: glucoseLogs.alertLevel,
      loggedAt: glucoseLogs.loggedAt,
      fastBrokenAt: glucoseLogs.fastBrokenAt,
    })
    .from(glucoseLogs)
    .where(eq(glucoseLogs.userId, userId))
    .orderBy(desc(glucoseLogs.loggedAt))
    .limit(limit);
}
