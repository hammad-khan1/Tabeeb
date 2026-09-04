import { after } from 'next/server';
import { and, eq, lt, or, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { documents } from '../../drizzle/schema';
import { processDocument } from './document-processor';

/**
 * Background processing.
 *
 * The upload route used to call `processDocument(...).catch(...)` and return
 * immediately. On a serverless host the function can be frozen the moment the
 * response is sent, so a document could sit in `processing` forever with no retry and
 * nothing to notice it.
 *
 * `after()` is Next's supported way to keep work running past the response — the
 * platform holds the invocation open for it. That covers the common case. What it
 * cannot survive is the instance dying mid-run, which is what `sweepStalledDocuments`
 * is for: any row left in `processing` past the timeout is recovered on the next
 * request that triggers a sweep.
 *
 * A durable external queue is still the right long-term answer for retries across
 * deploys; this is the honest version of that within a single Next app.
 */

/** How long a document may sit in `processing` before it is considered abandoned. */
const STALL_TIMEOUT_MS = 15 * 60 * 1000;

/** Sweeping on every request would be wasteful; once every few minutes is enough. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let lastSweepAt = 0;

async function runProcessing(documentId: string, userId: string): Promise<void> {
  try {
    await processDocument(documentId, userId);
  } catch (error) {
    // processDocument already records the failure on the row; this is just the log.
    console.error(
      `[ProcessingQueue] ${documentId} failed:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Schedules processing to continue after the response is sent. Falls back to a
 * detached promise outside a request scope (tests, scripts), where `after` throws.
 */
export function enqueueProcessing(documentId: string, userId: string): void {
  try {
    after(() => runProcessing(documentId, userId));
  } catch {
    void runProcessing(documentId, userId);
  }
}

/**
 * Marks abandoned runs as failed so they stop showing a spinner forever and can be
 * retried from the UI. Deliberately does not auto-retry: a document that killed the
 * instance once will probably do it again, and a retry loop on a paid vision model is
 * an expensive way to find that out.
 */
export async function sweepStalledDocuments(): Promise<number> {
  const cutoff = new Date(Date.now() - STALL_TIMEOUT_MS);

  const recovered = await getDb()
    .update(documents)
    .set({
      extractionStatus: 'failed',
      extractionNotes:
        'Processing stopped unexpectedly and did not finish. Use "Reprocess" to try again.',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(documents.extractionStatus, 'processing'),
        or(
          lt(documents.processingStartedAt, cutoff),
          // Rows written before processingStartedAt existed.
          and(isNull(documents.processingStartedAt), lt(documents.updatedAt, cutoff))
        )
      )
    )
    .returning({ id: documents.id });

  if (recovered.length > 0) {
    console.warn(`[ProcessingQueue] recovered ${recovered.length} stalled document(s)`);
  }
  return recovered.length;
}

/** Cheap to call from any read path; self-throttles to SWEEP_INTERVAL_MS. */
export function maybeSweepStalledDocuments(): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  const run = () =>
    sweepStalledDocuments().catch((error) =>
      console.error('[ProcessingQueue] sweep failed:', error)
    );

  try {
    after(run);
  } catch {
    void run();
  }
}

/** Documents currently mid-flight, for a status indicator. */
export async function countProcessing(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        or(
          eq(documents.extractionStatus, 'pending'),
          eq(documents.extractionStatus, 'processing')
        )
      )
    );
  return row?.count ?? 0;
}
