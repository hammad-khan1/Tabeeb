import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/env';
import { ApiError, notFound } from '@/lib/api-error';
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
  documentCount: number;
}

export interface SharedHistoryData {
  title: string | null;
  expiresAt: Date;
  viewCount: number;
  history: MedicalHistorySummary;
}

/**
 * Recipients open /share/<token>, which is deliberately outside the (authenticated)
 * route group and off the protected matcher — a share link that demands the
 * recipient log in as the patient is not a share link.
 */
export function shareUrlFor(token: string): string {
  return `${appUrl().replace(/\/+$/, '')}/share/${token}`;
}

export async function createShareLink(
  userId: string,
  options: CreateShareLinkOptions = {}
): Promise<ShareLinkResult> {
  const { title, documentIds = [], expiresInHours = 168 } = options;

  // Only the caller's own documents may be scoped in, so a guessed id cannot widen
  // the share to somebody else's record.
  let ownedIds: string[] = [];
  if (documentIds.length > 0) {
    const rows = await getDb()
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.userId, userId), inArray(documents.id, documentIds)));
    ownedIds = rows.map((row) => row.id);

    if (ownedIds.length === 0) {
      throw new ApiError(400, 'None of the selected documents were found in your record.');
    }
  }

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await getDb().insert(shareLinks).values({
    userId,
    token,
    title: title ?? null,
    documentIds: ownedIds,
    expiresAt,
  });

  return {
    token,
    url: shareUrlFor(token),
    expiresAt,
    documentCount: ownedIds.length,
  };
}

export async function getSharedHistory(token: string): Promise<SharedHistoryData> {
  // Expiry is enforced in the WHERE clause so a stale row can never be served, and
  // the view count is incremented in SQL rather than read-modify-write.
  const [link] = await getDb()
    .update(shareLinks)
    .set({ viewCount: sql`${shareLinks.viewCount} + 1` })
    .where(
      and(
        eq(shareLinks.token, token),
        eq(shareLinks.isActive, true),
        sql`${shareLinks.expiresAt} > now()`
      )
    )
    .returning();

  if (!link) {
    // Deliberately one message for "wrong token", "revoked" and "expired": telling a
    // guesser which of those they hit turns the token space into an oracle.
    throw notFound('This link is no longer available. It may have expired or been revoked.');
  }

  // An empty documentIds array means the share was never scoped — the whole record.
  const scope = link.documentIds.length > 0 ? link.documentIds : undefined;
  const history = await getMedicalHistorySummary(link.userId, scope);

  return {
    title: link.title,
    expiresAt: link.expiresAt,
    viewCount: link.viewCount ?? 1,
    history,
  };
}

export async function listShareLinks(userId: string) {
  const rows = await getDb()
    .select({
      token: shareLinks.token,
      title: shareLinks.title,
      documentIds: shareLinks.documentIds,
      expiresAt: shareLinks.expiresAt,
      isActive: shareLinks.isActive,
      viewCount: shareLinks.viewCount,
      createdAt: shareLinks.createdAt,
    })
    .from(shareLinks)
    .where(eq(shareLinks.userId, userId))
    .orderBy(desc(shareLinks.createdAt))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    url: shareUrlFor(row.token),
    documentCount: row.documentIds.length,
    isExpired: row.expiresAt.getTime() <= Date.now(),
  }));
}

/** Revoking keeps the row so the view count stays auditable. */
export async function revokeShareLink(userId: string, token: string): Promise<void> {
  const [revoked] = await getDb()
    .update(shareLinks)
    .set({ isActive: false })
    .where(and(eq(shareLinks.token, token), eq(shareLinks.userId, userId)))
    .returning({ token: shareLinks.token });

  if (!revoked) throw notFound('Share link not found.');
}
