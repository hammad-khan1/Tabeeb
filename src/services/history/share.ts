import { eq, and, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { shareLinks, documents } from '../../../drizzle/schema';
import { getMedicalHistorySummary, type MedicalHistorySummary } from './summarizer';

interface CreateShareLinkOptions {
  title?: string;
  documentIds?: string[];
  expiresInHours?: number;
}

interface ShareLinkResult {
  token: string;
  url: string;
  expiresAt: Date;
}

interface SharedHistoryData {
  title: string | null;
  expiresAt: Date;
  viewCount: number;
  history: MedicalHistorySummary;
}

export async function createShareLink(
  userId: string,
  options: CreateShareLinkOptions = {}
): Promise<ShareLinkResult> {
  const { title, documentIds = [], expiresInHours = 168 } = options;

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await getDb().insert(shareLinks).values({
    userId,
    token,
    title: title ?? null,
    documentIds,
    expiresAt,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const url = `${baseUrl}/share/${token}`;

  return { token, url, expiresAt };
}

export async function getSharedHistory(
  token: string
): Promise<SharedHistoryData> {
  const [link] = await getDb()    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.token, token), eq(shareLinks.isActive, true)))
    .limit(1);

  if (!link) {
    throw new Error('Share link not found or inactive');
  }

  if (new Date() > link.expiresAt) {
    throw new Error('Share link has expired');
  }

  await getDb()    .update(shareLinks)
    .set({ viewCount: (link.viewCount ?? 0) + 1 })
    .where(eq(shareLinks.id, link.id));

  let history: MedicalHistorySummary;

  if (link.documentIds.length > 0) {
    history = await getFilteredHistory(link.userId, link.documentIds);
  } else {
    history = await getMedicalHistorySummary(link.userId);
  }

  return {
    title: link.title,
    expiresAt: link.expiresAt,
    viewCount: (link.viewCount ?? 0) + 1,
    history,
  };
}

async function getFilteredHistory(
  userId: string,
  documentIds: string[]
): Promise<MedicalHistorySummary> {
  const full = await getMedicalHistorySummary(userId);

  const filteredDocs = await getDb()    .select()
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        inArray(documents.id, documentIds)
      )
    );

  const timelineMap = new Map<string, Array<{
    date: Date;
    type: string;
    title: string;
    hospital?: string | null;
    doctorName?: string | null;
  }>>();

  for (const doc of filteredDocs) {
    const date = doc.documentDate ?? doc.createdAt;
    if (!date) continue;
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!timelineMap.has(monthKey)) {
      timelineMap.set(monthKey, []);
    }
    timelineMap.get(monthKey)!.push({
      date,
      type: doc.documentType,
      title: doc.title,
      hospital: doc.hospital,
      doctorName: doc.doctorName,
    });
  }

  const visitTimeline = Array.from(timelineMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, events]) => ({
      month,
      events: events.sort((a, b) => b.date.getTime() - a.date.getTime()),
    }));

  return {
    conditions: full.conditions,
    currentMedications: full.currentMedications,
    allergies: full.allergies,
    recentLabResults: full.recentLabResults,
    visitTimeline,
    documentCount: filteredDocs.length,
  };
}
