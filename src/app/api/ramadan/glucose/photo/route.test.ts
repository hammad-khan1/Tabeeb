import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { HAS_DATABASE, USER_A, actAs, seedUsers, cleanup, db, tables, nextRequest } from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';

/** The vision model is the one thing faked: what matters is what the route does with its text. */
const ocr = vi.hoisted(() => ({ text: '62 mg/dL' }));
vi.mock('@/services/text-extractors/image-extractor', () => ({
  ocrImage: async () => ({ text: ocr.text, confidence: 90, isHandwritten: false }),
}));

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

describeIfDb('Ramzan glucometer photo', () => {
  beforeAll(async () => {
    await seedUsers();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    resetRateLimits();
    actAs(USER_A);
    await db.delete(tables.glucoseLogs).where(eq(tables.glucoseLogs.userId, USER_A));
  });

  async function upload(file: File) {
    const form = new FormData();
    form.append('photo', file);
    const { POST } = await import('./route');
    return POST(nextRequest('http://t/api/ramadan/glucose/photo', { method: 'POST', body: form }));
  }

  const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'meter.jpg', { type: 'image/jpeg' });

  it('never stores a number a vision model read until the patient confirms it', async () => {
    const response = await upload(photo());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ status: 'needs_confirmation', reading: { value: 62, unit: 'mg_dl' } });
    // The low is shown now, not after the question.
    expect(body.provisionalAlert.action.roman).toBe('Roza foran khol dein aur meetha lein.');

    const stored = await db.select().from(tables.glucoseLogs).where(eq(tables.glucoseLogs.userId, USER_A));
    expect(stored).toHaveLength(0);
  });

  it('rejects a file that is not an image', async () => {
    const response = await upload(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(response.status).toBe(400);
  });
});
