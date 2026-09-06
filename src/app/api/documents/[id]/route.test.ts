import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  HAS_DATABASE,
  USER_A,
  USER_B,
  actAs,
  seedUsers,
  seedDocument,
  cleanup,
  documentExists,
  params,
  jsonRequest,
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';

/**
 * Tenancy tests for the document routes, against a real database.
 *
 * The worst defect this codebase has had was here: reprocess selected a document by
 * id with no ownership filter and then ran the pipeline as its owner, so any signed-in
 * user could trigger a rewrite of a stranger's medical record. A mocked database
 * cannot catch that — it returns the rows it was given whatever the predicate says.
 *
 * The shape of every test below is the same: user B owns a document, user A asks for
 * it, and A must be told it does not exist. Not 403, which would confirm it does.
 */

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

describeIfDb('document routes · tenancy', () => {
  let ownedByB: string;

  beforeAll(async () => {
    await seedUsers();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    ownedByB = await seedDocument(USER_B, { title: "B's private record" });
    actAs(USER_A);
  });

  describe('GET', () => {
    it("does not return another user's document", async () => {
      const { GET } = await import('./route');
      const response = await GET(
        new Request(`http://t/api/documents/${ownedByB}`) as never,
        params({ id: ownedByB })
      );
      expect(response.status).toBe(404);
    });

    it('does not leak the title in the error body', async () => {
      const { GET } = await import('./route');
      const response = await GET(
        new Request(`http://t/api/documents/${ownedByB}`) as never,
        params({ id: ownedByB })
      );
      expect(JSON.stringify(await response.json())).not.toContain('private record');
    });

    it('returns the document to its owner', async () => {
      actAs(USER_B);
      const { GET } = await import('./route');
      const response = await GET(
        new Request(`http://t/api/documents/${ownedByB}`) as never,
        params({ id: ownedByB })
      );
      expect(response.status).toBe(200);
      expect((await response.json()).title).toBe("B's private record");
    });

    it('never exposes the internal storage path', async () => {
      actAs(USER_B);
      const { GET } = await import('./route');
      const response = await GET(
        new Request(`http://t/api/documents/${ownedByB}`) as never,
        params({ id: ownedByB })
      );
      expect(await response.json()).not.toHaveProperty('storagePath');
    });

    it('rejects an id that is not a uuid rather than passing it to Postgres', async () => {
      const { GET } = await import('./route');
      const response = await GET(
        new Request('http://t/api/documents/not-a-uuid') as never,
        params({ id: 'not-a-uuid' })
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PATCH', () => {
    it("cannot rename another user's document", async () => {
      const { PATCH } = await import('./route');
      const response = await PATCH(
        jsonRequest(`http://t/api/documents/${ownedByB}`, 'PATCH', { title: 'seized' }) as never,
        params({ id: ownedByB })
      );
      expect(response.status).toBe(404);
    });

    it('leaves the row untouched after a rejected write', async () => {
      const { PATCH, GET } = await import('./route');
      await PATCH(
        jsonRequest(`http://t/api/documents/${ownedByB}`, 'PATCH', { title: 'seized' }) as never,
        params({ id: ownedByB })
      );

      actAs(USER_B);
      const after = await GET(
        new Request(`http://t/api/documents/${ownedByB}`) as never,
        params({ id: ownedByB })
      );
      expect((await after.json()).title).toBe("B's private record");
    });

    it('rejects an unparseable date instead of erroring in the database', async () => {
      actAs(USER_B);
      const { PATCH } = await import('./route');
      const response = await PATCH(
        jsonRequest(`http://t/api/documents/${ownedByB}`, 'PATCH', {
          documentDate: 'yesterday',
        }) as never,
        params({ id: ownedByB })
      );
      expect(response.status).toBe(400);
    });

    it('ignores fields that are not editable', async () => {
      actAs(USER_B);
      const { PATCH } = await import('./route');
      const response = await PATCH(
        jsonRequest(`http://t/api/documents/${ownedByB}`, 'PATCH', {
          userId: USER_A,
          extractionStatus: 'confirmed',
        }) as never,
        params({ id: ownedByB })
      );
      // Nothing editable was sent, so there is nothing to do.
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it("cannot delete another user's document", async () => {
      const { DELETE } = await import('./route');
      const response = await DELETE(
        new Request(`http://t/api/documents/${ownedByB}`, { method: 'DELETE' }) as never,
        params({ id: ownedByB })
      );
      expect(response.status).toBe(404);
    });

    it('leaves the document in place after a rejected delete', async () => {
      const { DELETE } = await import('./route');
      await DELETE(
        new Request(`http://t/api/documents/${ownedByB}`, { method: 'DELETE' }) as never,
        params({ id: ownedByB })
      );
      expect(await documentExists(ownedByB)).toBe(true);
    });

    it('lets the owner delete their own', async () => {
      actAs(USER_B);
      const { DELETE } = await import('./route');
      const response = await DELETE(
        new Request(`http://t/api/documents/${ownedByB}`, { method: 'DELETE' }) as never,
        params({ id: ownedByB })
      );
      expect(response.status).toBe(200);
      expect(await documentExists(ownedByB)).toBe(false);
    });
  });
});
