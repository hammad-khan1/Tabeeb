import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  HAS_DATABASE,
  USER_A,
  USER_B,
  actAs,
  seedUsers,
  seedDocument,
  cleanup,
  db,
  tables,
  jsonRequest,
  nextRequest,
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';

/**
 * The share flow, against a real database.
 *
 * A share link scoped to specific documents used to return the patient's entire
 * record: only the visit timeline was filtered, while conditions, medications,
 * allergies and lab results came from the unscoped summary. A patient sharing one lab
 * report with one doctor handed over everything, including whatever they had
 * deliberately left out.
 *
 * That is the kind of leak that looks fine in the response shape and is only visible
 * if a test seeds two documents and checks that the second one's contents are absent.
 */

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

describeIfDb('share links', () => {
  let sharedDoc: string;
  let privateDoc: string;

  beforeAll(async () => {
    await seedUsers();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    actAs(USER_A);

    sharedDoc = await seedDocument(USER_A, { title: 'Shared lab report' });
    privateDoc = await seedDocument(USER_A, { title: 'Private psychiatric note' });

    // A diagnosis on each, so scoping can be observed rather than assumed.
    await db.insert(tables.diagnoses).values([
      { documentId: sharedDoc, userId: USER_A, condition: 'Anemia' },
      { documentId: privateDoc, userId: USER_A, condition: 'Major depressive disorder' },
    ]);
    await db.insert(tables.medications).values([
      { documentId: sharedDoc, userId: USER_A, name: 'Ferrous sulphate' },
      { documentId: privateDoc, userId: USER_A, name: 'Sertraline' },
    ]);
  });

  async function createLink(documentIds?: string[]): Promise<string> {
    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest('http://t/api/history/share', 'POST', {
        title: 'For Dr Rahman',
        ...(documentIds ? { documentIds } : {}),
      }) as never
    );
    expect(response.status).toBe(201);
    return (await response.json()).token;
  }

  async function readShared(token: string) {
    const { getSharedHistory } = await import('@/services/history/share');
    return getSharedHistory(token);
  }

  it('creates a link the patient can hand over', async () => {
    const token = await createLink([sharedDoc]);
    expect(token).toBeTruthy();
  });

  it('scopes conditions to the shared document', async () => {
    const history = await readShared(await createLink([sharedDoc]));
    const conditions = history.history.conditions.map((c) => c.condition);

    expect(conditions).toContain('Anemia');
    expect(conditions).not.toContain('Major depressive disorder');
  });

  it('scopes medications to the shared document', async () => {
    const history = await readShared(await createLink([sharedDoc]));
    const names = history.history.currentMedications.map((m) => m.name);

    expect(names).toContain('Ferrous sulphate');
    expect(names).not.toContain('Sertraline');
  });

  it('does not leak the withheld document anywhere in the payload', async () => {
    // The broadest assertion: whatever shape the summary grows into, nothing from the
    // document the patient chose not to share may appear in it.
    const history = await readShared(await createLink([sharedDoc]));
    const serialised = JSON.stringify(history);

    expect(serialised).not.toContain('Private psychiatric note');
    expect(serialised).not.toContain('Major depressive disorder');
    expect(serialised).not.toContain('Sertraline');
  });

  it('shares everything when no documents are named', async () => {
    const history = await readShared(await createLink());
    const conditions = history.history.conditions.map((c) => c.condition);

    expect(conditions).toContain('Anemia');
    expect(conditions).toContain('Major depressive disorder');
  });

  it('refuses a token that does not exist', async () => {
    await expect(readShared('nope-not-a-real-token')).rejects.toThrow();
  });

  it('refuses an expired link', async () => {
    const token = await createLink([sharedDoc]);
    await db
      .update(tables.shareLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(tables.shareLinks.token, token));

    await expect(readShared(token)).rejects.toThrow(/expired/i);
  });

  it('refuses a revoked link', async () => {
    const token = await createLink([sharedDoc]);
    const { DELETE } = await import('./route');
    const response = await DELETE(
      nextRequest(`http://t/api/history/share?token=${token}`, { method: 'DELETE' })
    );
    expect(response.status).toBe(200);

    await expect(readShared(token)).rejects.toThrow();
  });

  it("cannot revoke another user's link", async () => {
    const token = await createLink([sharedDoc]);

    actAs(USER_B);
    const { DELETE } = await import('./route');
    const response = await DELETE(
      nextRequest(`http://t/api/history/share?token=${token}`, { method: 'DELETE' })
    );
    expect(response.status).toBe(404);

    // And it still works for its owner.
    await expect(readShared(token)).resolves.toBeTruthy();
  });

  it("does not list another user's links", async () => {
    await createLink([sharedDoc]);

    actAs(USER_B);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('caps how long a link can live', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      jsonRequest('http://t/api/history/share', 'POST', {
        expiresInHours: 24 * 365,
      }) as never
    );
    expect(response.status).toBe(400);
  });
});
