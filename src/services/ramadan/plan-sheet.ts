/**
 * The one page a patient takes to their doctor before Ramzan: the risk score with the
 * reason for every point, current medicines as the record has them, recent HbA1c, and
 * the last two weeks of logged glucose.
 *
 * It reports what is recorded and proposes nothing. The doctor sets the Ramzan doses;
 * the patient then uploads that prescription like any other.
 */

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notFound } from '@/lib/api-error';
import {
  glucoseLogs,
  labResults,
  medications,
  ramadanPlans,
  shareLinks,
  users,
  type RamadanScoreItem,
} from '../../../drizzle/schema';
import { createShareLink, listShareLinksForPlan } from '../history/share';
import type { RiskBand } from './constants';

const GLUCOSE_DAYS = 14;
const HBA1C_COUNT = 3;

export interface PlanSheet {
  patientName: string | null;
  plan: {
    year: number;
    ramadanStart: string;
    ramadanEnd: string;
    city: string | null;
    riskScore: number | null;
    riskBand: RiskBand | null;
    scoreItems: RamadanScoreItem[];
    doctorConfirmed: boolean;
  };
  medications: Array<{
    name: string;
    genericName: string | null;
    dosage: string | null;
    frequency: string | null;
    prescribedDate: Date | null;
  }>;
  hba1c: Array<{ value: string; unit: string | null; testDate: Date }>;
  glucose: Array<{
    valueMgDl: number | null;
    loggedAt: Date;
    alertLevel: string;
    symptoms: string[];
    fastBrokenAt: Date | null;
  }>;
  generatedAt: Date;
}

export async function buildPlanSheet(userId: string, planId: string, now: Date = new Date()): Promise<PlanSheet> {
  const db = getDb();

  const [plan] = await db
    .select()
    .from(ramadanPlans)
    .where(and(eq(ramadanPlans.id, planId), eq(ramadanPlans.userId, userId)))
    .limit(1);
  if (!plan) throw notFound('Ramzan plan not found.');

  const since = new Date(now.getTime() - GLUCOSE_DAYS * 24 * 60 * 60 * 1000);

  const [[user], meds, hba1c, glucose] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({
        name: medications.name,
        genericName: medications.genericName,
        dosage: medications.dosage,
        frequency: medications.frequency,
        prescribedDate: medications.prescribedDate,
      })
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isActive, true)))
      .orderBy(desc(medications.prescribedDate))
      .limit(60),
    db
      .select({ value: labResults.value, unit: labResults.unit, testDate: labResults.testDate })
      .from(labResults)
      .where(and(eq(labResults.userId, userId), eq(labResults.canonicalTestName, 'hba1c')))
      .orderBy(desc(labResults.testDate))
      .limit(HBA1C_COUNT),
    db
      .select({
        valueMgDl: glucoseLogs.valueMgDl,
        loggedAt: glucoseLogs.loggedAt,
        alertLevel: glucoseLogs.alertLevel,
        symptoms: glucoseLogs.symptoms,
        fastBrokenAt: glucoseLogs.fastBrokenAt,
      })
      .from(glucoseLogs)
      .where(and(eq(glucoseLogs.userId, userId), gte(glucoseLogs.loggedAt, since)))
      .orderBy(desc(glucoseLogs.loggedAt))
      .limit(200),
  ]);

  return {
    patientName: user?.name ?? null,
    plan: {
      year: plan.year,
      ramadanStart: plan.ramadanStart,
      ramadanEnd: plan.ramadanEnd,
      city: plan.city,
      riskScore: plan.riskScore,
      riskBand: plan.riskBand,
      scoreItems: plan.scoreItems ?? [],
      doctorConfirmed: plan.doctorConfirmed ?? false,
    },
    medications: meds,
    hba1c,
    glucose: glucose.map((row) => ({ ...row, symptoms: row.symptoms ?? [] })),
    generatedAt: now,
  };
}

export async function createPlanSheetLink(userId: string, planId: string, expiresInHours: number) {
  return createShareLink(userId, { title: 'Ramzan plan sheet', ramadanPlanId: planId, expiresInHours });
}

export async function listPlanSheetLinks(userId: string, planId: string) {
  return listShareLinksForPlan(userId, planId);
}

export interface SharedPlanSheet {
  expiresAt: Date;
  viewCount: number;
  sheet: PlanSheet;
}

/** Public: what /share/<token> shows for a plan-sheet link. */
export async function getSharedPlanSheet(token: string): Promise<SharedPlanSheet> {
  const [link] = await getDb()
    .update(shareLinks)
    .set({ viewCount: sql`${shareLinks.viewCount} + 1` })
    .where(
      and(
        eq(shareLinks.token, token),
        eq(shareLinks.isActive, true),
        sql`${shareLinks.expiresAt} > now()`,
        isNotNull(shareLinks.ramadanPlanId)
      )
    )
    .returning();

  // One message for every failure, as for history links.
  if (!link?.ramadanPlanId) {
    throw notFound('This link is no longer available. It may have expired or been revoked.');
  }

  return {
    expiresAt: link.expiresAt,
    viewCount: link.viewCount ?? 1,
    sheet: await buildPlanSheet(link.userId, link.ramadanPlanId),
  };
}
