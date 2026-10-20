import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/env';
import { ApiError, notFound } from '@/lib/api-error';
import { briefingShareLinks, documents } from '../../../drizzle/schema';
import { generatePatientBriefing } from './briefing-generator';
import type { PatientBriefingData } from './types';

export interface CreateBriefingShareLinkOptions {
  title?: string;
  documentIds?: string[];
  includedSections?: string[];
  dateRangeFrom?: string | null;
  dateRangeTo?: string | null;
  expiresInHours?: number;
}

export interface BriefingShareLinkResult {
  token: string;
  url: string;
  expiresAt: Date;
  documentCount: number;
  includedSections: string[];
}

export interface SharedBriefingData {
  title: string | null;
  expiresAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
  includedSections: string[];
  briefing: PatientBriefingData;
}

export function briefingShareUrlFor(token: string): string {
  return `${appUrl().replace(/\/+$/, '')}/share/briefing/${token}`;
}

export async function createBriefingShareLink(
  userId: string,
  options: CreateBriefingShareLinkOptions = {}
): Promise<BriefingShareLinkResult> {
  const {
    title,
    documentIds = [],
    includedSections = [
      'summary',
      'conditions',
      'doctors',
      'medications',
      'allergies',
      'labs',
      'trends',
      'conflicts',
      'questions',
      'timeline',
      'citations',
    ],
    dateRangeFrom,
    dateRangeTo,
    expiresInHours = 168, // Default 7 days
  } = options;

  // Cap expiration to 720 hours (30 days) maximum
  const safeHours = Math.max(1, Math.min(expiresInHours, 720));

  // Only the caller's own documents may be scoped in
  let ownedIds: string[] = [];
  if (documentIds.length > 0) {
    const rows = await getDb()
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.userId, userId), inArray(documents.id, documentIds)));
    ownedIds = rows.map((r) => r.id);

    if (ownedIds.length === 0) {
      throw new ApiError(400, 'None of the selected documents were found in your record.');
    }
  }

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + safeHours * 60 * 60 * 1000);

  await getDb().insert(briefingShareLinks).values({
    userId,
    token,
    title: title?.trim() || 'Doctor-Ready Patient Briefing',
    documentIds: ownedIds,
    includedSections,
    dateRangeFrom: dateRangeFrom ? new Date(dateRangeFrom) : null,
    dateRangeTo: dateRangeTo ? new Date(dateRangeTo) : null,
    expiresAt,
  });

  return {
    token,
    url: briefingShareUrlFor(token),
    expiresAt,
    documentCount: ownedIds.length,
    includedSections,
  };
}

export async function getSharedBriefing(token: string): Promise<SharedBriefingData> {
  // Update viewCount and lastViewedAt atomically on valid active links
  const [link] = await getDb()
    .update(briefingShareLinks)
    .set({
      viewCount: sql`${briefingShareLinks.viewCount} + 1`,
      lastViewedAt: new Date(),
    })
    .where(
      and(
        eq(briefingShareLinks.token, token),
        eq(briefingShareLinks.isActive, true),
        sql`${briefingShareLinks.expiresAt} > now()`
      )
    )
    .returning();

  if (!link) {
    throw notFound('This doctor briefing link is no longer available. It may have expired or been revoked.');
  }

  const scope = link.documentIds.length > 0 ? link.documentIds : undefined;
  const rawBriefing = await generatePatientBriefing(link.userId, {
    documentIds: scope,
    from: link.dateRangeFrom ? link.dateRangeFrom.toISOString() : undefined,
    to: link.dateRangeTo ? link.dateRangeTo.toISOString() : undefined,
  });

  // Filter sections according to patient's specified permissions
  const allowed = new Set(link.includedSections ?? []);
  const hasFilter = allowed.size > 0;

  const filteredBriefing: PatientBriefingData = {
    ...rawBriefing,
    clinicalSummary: hasFilter && !allowed.has('summary') ? 'Summary withheld by patient.' : rawBriefing.clinicalSummary,
    conditions: hasFilter && !allowed.has('conditions') ? [] : rawBriefing.conditions,
    doctors: hasFilter && !allowed.has('doctors') ? [] : rawBriefing.doctors,
    currentMedications: hasFilter && !allowed.has('medications') ? [] : rawBriefing.currentMedications,
    historicalMedications: hasFilter && !allowed.has('medications') ? [] : rawBriefing.historicalMedications,
    allergies: hasFilter && !allowed.has('allergies') ? [] : rawBriefing.allergies,
    recentLabResults: hasFilter && !allowed.has('labs') ? [] : rawBriefing.recentLabResults,
    labTrends: hasFilter && !allowed.has('trends') ? [] : rawBriefing.labTrends,
    treatmentConflicts: hasFilter && !allowed.has('conflicts') ? [] : rawBriefing.treatmentConflicts,
    consultationQuestions: hasFilter && !allowed.has('questions') ? [] : rawBriefing.consultationQuestions,
    doctorTimeline: hasFilter && !allowed.has('timeline') ? [] : rawBriefing.doctorTimeline,
    citations: hasFilter && !allowed.has('citations') ? [] : rawBriefing.citations,
  };

  return {
    title: link.title,
    expiresAt: link.expiresAt,
    viewCount: link.viewCount ?? 1,
    lastViewedAt: link.lastViewedAt,
    includedSections: link.includedSections ?? [],
    briefing: filteredBriefing,
  };
}

export async function listBriefingShareLinks(userId: string) {
  const rows = await getDb()
    .select({
      token: briefingShareLinks.token,
      title: briefingShareLinks.title,
      documentIds: briefingShareLinks.documentIds,
      includedSections: briefingShareLinks.includedSections,
      expiresAt: briefingShareLinks.expiresAt,
      isActive: briefingShareLinks.isActive,
      viewCount: briefingShareLinks.viewCount,
      lastViewedAt: briefingShareLinks.lastViewedAt,
      revokedAt: briefingShareLinks.revokedAt,
      createdAt: briefingShareLinks.createdAt,
    })
    .from(briefingShareLinks)
    .where(eq(briefingShareLinks.userId, userId))
    .orderBy(desc(briefingShareLinks.createdAt))
    .limit(100);

  return rows.map((r) => ({
    ...r,
    url: briefingShareUrlFor(r.token),
    documentCount: r.documentIds.length,
    isExpired: r.expiresAt.getTime() <= Date.now(),
  }));
}

export async function revokeBriefingShareLink(userId: string, token: string): Promise<void> {
  const [revoked] = await getDb()
    .update(briefingShareLinks)
    .set({
      isActive: false,
      revokedAt: new Date(),
    })
    .where(and(eq(briefingShareLinks.token, token), eq(briefingShareLinks.userId, userId)))
    .returning({ token: briefingShareLinks.token });

  if (!revoked) {
    throw notFound('Briefing share link not found or already revoked.');
  }
}
