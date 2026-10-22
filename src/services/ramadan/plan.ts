/**
 * The patient's Ramzan plan for a year: dates, place, intent, and the saved score.
 * Every read and write is scoped by user.
 */

import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { badRequest, notFound } from '@/lib/api-error';
import { documents, ramadanPlans, type RamadanScoreItem } from '../../../drizzle/schema';
import { RISK_ITEMS, type RiskItemId } from './constants';
import { collectRiskInputs, type FilledInput, type PendingInput } from './auto-fill';
import { findCity, localDate, validateLocation } from './prayer-times';
import { scoreRisk, type ScoreAnswer, type ScoreResult } from './risk-score';

export type RamadanPlan = typeof ramadanPlans.$inferSelect;

/**
 * Expected dates, to pre-fill the form. Ramzan starts on moon sighting, so these are
 * estimates the patient confirms or corrects; they are never used unconfirmed.
 */
const ESTIMATED_RAMADAN: ReadonlyArray<{ year: number; start: string; end: string }> = [
  { year: 2027, start: '2027-02-08', end: '2027-03-09' },
  { year: 2028, start: '2028-01-28', end: '2028-02-26' },
];

export function estimatedRamadan(now: Date = new Date()) {
  const today = localDate(now);
  return ESTIMATED_RAMADAN.find((entry) => entry.end >= today) ?? null;
}

/** The plan for the coming or current Ramzan, else the most recent one. */
export async function getCurrentPlan(userId: string, now: Date = new Date()): Promise<RamadanPlan | null> {
  const today = localDate(now);
  const [upcoming] = await getDb()
    .select()
    .from(ramadanPlans)
    .where(and(eq(ramadanPlans.userId, userId), gte(ramadanPlans.ramadanEnd, today)))
    .orderBy(asc(ramadanPlans.ramadanStart))
    .limit(1);
  if (upcoming) return upcoming;

  const [latest] = await getDb()
    .select()
    .from(ramadanPlans)
    .where(eq(ramadanPlans.userId, userId))
    .orderBy(desc(ramadanPlans.ramadanStart))
    .limit(1);
  return latest ?? null;
}

export async function requireCurrentPlan(userId: string): Promise<RamadanPlan> {
  const plan = await getCurrentPlan(userId);
  if (!plan) throw notFound('No Ramzan plan yet. Start one first.');
  return plan;
}

export interface PlanInput {
  ramadanStart: string;
  ramadanEnd: string;
  intendsToFast: boolean;
  city?: string;
  latitude?: number;
  longitude?: number;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
}

/** One plan per user per year: a second save for the same year updates it. */
export async function savePlan(userId: string, input: PlanInput): Promise<RamadanPlan> {
  let place: { city: string | null; latitude: number; longitude: number };
  if (input.city) {
    const city = findCity(input.city);
    if (!city) throw badRequest(`Unknown city "${input.city}".`);
    place = { city: city.name, latitude: city.latitude, longitude: city.longitude };
  } else if (input.latitude !== undefined && input.longitude !== undefined) {
    place = { city: null, ...validateLocation({ latitude: input.latitude, longitude: input.longitude }) };
  } else {
    throw badRequest('Choose a city or share your location.');
  }

  const values = {
    year: Number(input.ramadanStart.slice(0, 4)),
    ramadanStart: input.ramadanStart,
    ramadanEnd: input.ramadanEnd,
    intendsToFast: input.intendsToFast,
    ...place,
    caregiverName: input.caregiverName ?? null,
    caregiverPhone: input.caregiverPhone ?? null,
    status: input.intendsToFast ? ('active' as const) : ('draft' as const),
    updatedAt: new Date(),
  };

  const [plan] = await getDb()
    .insert(ramadanPlans)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: [ramadanPlans.userId, ramadanPlans.year], set: values })
    .returning();
  return plan;
}

/**
 * Links the prescription that holds the doctor's Ramzan doses. Only then does the
 * schedule put medicines on the Sehri/Iftar clock, and only from that document.
 */
export async function setDoctorPlanDocument(
  userId: string,
  planId: string,
  documentId: string | null
): Promise<RamadanPlan> {
  if (documentId) {
    const [document] = await getDb()
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .limit(1);
    if (!document) throw notFound('Document not found.');
  }

  const [plan] = await getDb()
    .update(ramadanPlans)
    .set({ doctorPlanDocumentId: documentId, doctorConfirmed: documentId !== null, updatedAt: new Date() })
    .where(and(eq(ramadanPlans.id, planId), eq(ramadanPlans.userId, userId)))
    .returning();
  if (!plan) throw notFound('Ramzan plan not found.');
  return plan;
}

// ── Risk score ──────────────────────────────────────────────────────────────

export interface RiskAnswer {
  item: RiskItemId;
  option: string;
}

export interface RiskState {
  result: ScoreResult;
  /** Everything answered or filled so far, including items whose points are unverified. */
  items: RamadanScoreItem[];
  /** Items the record could not fill and the patient has not answered. */
  pending: PendingInput[];
  filled: FilledInput[];
}

function optionOf(item: RiskItemId, option: string) {
  return RISK_ITEMS.find((candidate) => candidate.id === item)?.options.find((o) => o.id === option) ?? null;
}

/**
 * Merges the record with the patient's answers and scores the result. An answer for an
 * item the record filled is an override, and keeps the record's provenance so the
 * doctor can see what was overridden.
 */
export async function computeRisk(
  userId: string,
  plan: RamadanPlan,
  newAnswers: readonly RiskAnswer[] = []
): Promise<RiskState> {
  const inputs = await collectRiskInputs(userId, plan);
  const filledByItem = new Map(inputs.filled.map((input) => [input.item, input]));

  const answers = new Map<RiskItemId, string>();
  for (const saved of plan.scoreItems ?? []) {
    if (saved.source !== 'record') answers.set(saved.item as RiskItemId, saved.option);
  }
  for (const answer of newAnswers) answers.set(answer.item, answer.option);

  const scoreAnswers: ScoreAnswer[] = [];
  for (const item of RISK_ITEMS) {
    const answered = answers.get(item.id);
    const record = filledByItem.get(item.id);

    if (answered !== undefined) {
      const option = optionOf(item.id, answered);
      if (!option) throw badRequest(`Unknown option "${answered}" for ${item.id}`);
      scoreAnswers.push({
        item: item.id,
        option: option.id,
        value: option.label,
        source: record ? 'override' : 'answer',
        ...(record ? { provenance: record.provenance } : {}),
      });
    } else if (record) {
      scoreAnswers.push({ ...record, source: 'record' });
    }
  }

  const result = scoreRisk(scoreAnswers);
  const items: RamadanScoreItem[] = scoreAnswers.map((answer) => ({
    item: answer.item,
    option: answer.option,
    points: optionOf(answer.item, answer.option)?.points ?? null,
    value: answer.value,
    source: answer.source,
    ...(answer.provenance ? { provenance: answer.provenance } : {}),
  }));

  return {
    result,
    items,
    pending: inputs.pending.filter((pending) => !answers.has(pending.item)),
    filled: inputs.filled,
  };
}

export async function saveRisk(userId: string, planId: string, state: RiskState): Promise<void> {
  const complete = state.result.status === 'complete' ? state.result : null;
  await getDb()
    .update(ramadanPlans)
    .set({
      scoreItems: state.items,
      riskScore: complete?.total ?? null,
      riskBand: complete?.band ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(ramadanPlans.id, planId), eq(ramadanPlans.userId, userId)));
}
