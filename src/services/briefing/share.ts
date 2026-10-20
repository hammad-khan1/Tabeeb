import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/env';
import { ApiError, notFound } from '@/lib/api-error';
import { briefingShareLinks, documents } from '../../../drizzle/schema';
import { generatePatientBriefing } from './briefing-generator';
import type { AttributedMedication, PatientBriefingData } from './types';

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
  originalDocumentsAvailable?: boolean;
  briefing: PatientBriefingData;
}

export const BRIEFING_SECTIONS = [
  'summary', 'conditions', 'doctors', 'medications', 'allergies', 'labs',
  'trends', 'conflicts', 'questions', 'timeline', 'citations',
] as const;

/** A whole source file cannot enforce redaction of withheld clinical sections. */
export function permitsOriginalDocuments(sections: string[] | null): boolean {
  return !sections?.length || BRIEFING_SECTIONS.every((section) => sections.includes(section));
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

  return {
    title: link.title,
    expiresAt: link.expiresAt,
    viewCount: link.viewCount ?? 1,
    lastViewedAt: link.lastViewedAt,
    includedSections: link.includedSections ?? [],
    originalDocumentsAvailable: permitsOriginalDocuments(link.includedSections),
    briefing: filterBriefingForShare(rawBriefing, link.includedSections),
  };
}

/** Keeps selected facts while withholding cross-section prose and source metadata. */
export function filterBriefingForShare(
  rawBriefing: PatientBriefingData, includedSections: string[] | null
): PatientBriefingData {
  // Filter sections according to patient's specified permissions
  const allowed = new Set(includedSections ?? []);
  const hasFilter = allowed.size > 0;
  const fullClinicalDisclosure = permitsOriginalDocuments(includedSections);
  if (fullClinicalDisclosure) return rawBriefing;
  const medicationAllowed = !hasFilter || allowed.has('medications');
  const allergyAllowed = !hasFilter || allowed.has('allergies');
  const conflictAllowed = !hasFilter || allowed.has('conflicts');
  const safety = rawBriefing.medicationSafety;
  const sharedMedications = (rows: AttributedMedication[]) => !medicationAllowed ? [] : rows.map((row) => {
    if (fullClinicalDisclosure) return row;
    return {
      ...row,
      sourceDocumentTitle: 'Source metadata withheld',
      sourceCitation: 'Source metadata withheld',
      // Free-text instructions/corrections can repeat withheld clinical sections.
      dosage: null, frequency: null, duration: null, route: null, patientCorrections: {},
      changesNote: 'Instructions and patient corrections are withheld in this section-limited share.',
      ...(!allowed.has('doctors') ? {
        prescribingDoctor: {
          ...row.prescribingDoctor, name: 'Prescriber withheld', specialty: null,
          hospital: null, isIdentified: false,
        },
        hospital: null,
      } : {}),
    };
  });

  const filteredBriefing: PatientBriefingData = {
    ...rawBriefing,
    clinicalSummary: hasFilter && !allowed.has('summary') ? 'Summary withheld by patient.'
      : fullClinicalDisclosure ? rawBriefing.clinicalSummary : 'This briefing contains only the sections selected by the patient. A complete clinical summary is withheld.',
    conditions: hasFilter && !allowed.has('conditions') ? [] : rawBriefing.conditions.map((row) => ({
      ...row,
      sourceDocumentTitle: 'Source metadata withheld',
      ...(!allowed.has('doctors') ? { diagnosingDoctor: null, hospital: null } : {}),
    })),
    doctors: hasFilter && !allowed.has('doctors') ? [] : rawBriefing.doctors.map((row) => ({
      ...row, sourceDocumentTitle: null, notes: null,
    })),
    currentMedications: sharedMedications(rawBriefing.currentMedications),
    historicalMedications: sharedMedications(rawBriefing.historicalMedications),
    allergies: hasFilter && !allowed.has('allergies') ? [] : rawBriefing.allergies.map((row) => ({
      ...row, sourceDocumentTitle: null,
      // Reaction narratives can contain medicines/conditions outside the selected scope.
      reaction: row.reaction ? 'Reaction narrative withheld in this section-limited share.' : null,
    })),
    recentLabResults: hasFilter && !allowed.has('labs') ? [] : rawBriefing.recentLabResults.map((row) => ({
      ...row, sourceDocumentTitle: 'Source metadata withheld', sourceCitation: 'Source metadata withheld',
      ...(!allowed.has('doctors') ? {
        orderingDoctor: { name: 'Ordering clinician withheld', specialty: null, isIdentified: false },
        performingFacility: null,
      } : {}),
    })),
    labTrends: hasFilter && !allowed.has('trends') ? [] : rawBriefing.labTrends,
    treatmentConflicts: !fullClinicalDisclosure ? [] : rawBriefing.treatmentConflicts,
    // Free-text plans/questions/citations can repeat data from excluded sections.
    consultationsAndPlans: fullClinicalDisclosure ? rawBriefing.consultationsAndPlans : [],
    uncertainties: fullClinicalDisclosure ? rawBriefing.uncertainties : [],
    consultationQuestions: fullClinicalDisclosure ? rawBriefing.consultationQuestions : [],
    doctorTimeline: fullClinicalDisclosure ? rawBriefing.doctorTimeline : [],
    citations: fullClinicalDisclosure ? rawBriefing.citations : [],
    medicationSafety: !medicationAllowed || !safety ? null : {
      ...safety,
      findings: conflictAllowed ? safety.findings.filter((finding) =>
        allergyAllowed || finding.category !== 'allergy_concern').map((finding) => fullClinicalDisclosure ? finding : ({
          ...finding, userId: '', resolutionNotes: null,
          explanation: 'A medication finding is recorded in the selected sources. Detailed source wording is withheld by section permissions; review it with a clinician who can access the complete records.',
          evidence: finding.evidence.filter((evidence) => allergyAllowed || evidence.kind !== 'allergy_record')
            .map((evidence) => ({ ...evidence, excerpt: null, documentTitle: null, documentDate: null })),
        })) : [],
      timeline: fullClinicalDisclosure ? safety.timeline : [],
    },
  };

  return filteredBriefing;
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
