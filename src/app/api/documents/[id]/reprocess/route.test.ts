import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  HAS_DATABASE,
  USER_A,
  USER_B,
  actAs,
  seedUsers,
  seedDocument,
  cleanup,
  enqueued,
  params,
  nextRequest,
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';

/**
 * Reprocess, against a real database.
 *
 * This route held the worst defect this codebase has had. It selected the document by
 * id alone, with no ownership filter, and then ran the pipeline as `doc.userId` — the
 * owner's identity, not the caller's. Any signed-in user with a document id could
 * trigger a rewrite of a stranger's medical record: the pipeline clears the derived
 * rows and rebuilds them, so a re-run that extracted differently, or hit a rate limit
 * part-way, left the victim's medications and lab results altered.
 *
 * The ownership guard inside processDocument would not have saved it, because the
 * route handed the guard the owner's id. Defence in depth only helps when the outer
 * layer is not passing the inner layer a valid-looking lie — which is exactly why this
 * needs a test at the route, not at the service.
 */

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

describeIfDb('POST /api/documents/[id]/reprocess', () => {
  let ownedByB: string;

  beforeAll(async () => {
    await seedUsers();
  });
  afterAll(async () => {
    await cleanup();
  });
  beforeEach(async () => {
    resetRateLimits();
    enqueued.length = 0;
    ownedByB = await seedDocument(USER_B, { title: "B's record" });
    actAs(USER_A);
  });

  it("refuses to reprocess another user's document", async () => {
    const { POST } = await import('./route');
    const response = await POST(
      nextRequest(`http://t/api/documents/${ownedByB}/reprocess`, { method: 'POST' }),
      params({ id: ownedByB })
    );
    expect(response.status).toBe(404);
  });

  it('does not queue any work for a document it refused', async () => {
    // The status code alone is not enough: the original bug queued the run and
    // answered 200, so the damage happened regardless of what the caller was told.
    const { POST } = await import('./route');
    await POST(
      nextRequest(`http://t/api/documents/${ownedByB}/reprocess`, { method: 'POST' }),
      params({ id: ownedByB })
    );
    expect(enqueued).toHaveLength(0);
  });

  it('lets the owner reprocess their own', async () => {
    actAs(USER_B);
    const { POST } = await import('./route');
    const response = await POST(
      nextRequest(`http://t/api/documents/${ownedByB}/reprocess`, { method: 'POST' }),
      params({ id: ownedByB })
    );

    expect(response.status).toBe(202);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].documentId).toBe(ownedByB);
  });

  it('runs the pipeline as the owner, never as some other caller', async () => {
    actAs(USER_B);
    const { POST } = await import('./route');
    await POST(
      nextRequest(`http://t/api/documents/${ownedByB}/reprocess`, { method: 'POST' }),
      params({ id: ownedByB })
    );
    expect(enqueued[0].userId).toBe(USER_B);
  });

  it('refuses a document that is already being processed', async () => {
    const inFlight = await seedDocument(USER_B, { extractionStatus: 'processing' });
    actAs(USER_B);

    const { POST } = await import('./route');
    const response = await POST(
      nextRequest(`http://t/api/documents/${inFlight}/reprocess`, { method: 'POST' }),
      params({ id: inFlight })
    );

    expect(response.status).toBe(400);
    expect(enqueued).toHaveLength(0);
  });

  it('rejects an id that is not a uuid', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      nextRequest('http://t/api/documents/nope/reprocess', { method: 'POST' }),
      params({ id: 'nope' })
    );
    expect(response.status).toBe(400);
  });

  it('answers 404 for a document that does not exist, same as one it may not touch', async () => {
    // A different status for "not yours" than for "not there" is an existence oracle.
    const { POST } = await import('./route');
    const missing = '00000000-0000-4000-8000-000000000000';
    const response = await POST(
      nextRequest(`http://t/api/documents/${missing}/reprocess`, { method: 'POST' }),
      params({ id: missing })
    );
    expect(response.status).toBe(404);
  });
});
