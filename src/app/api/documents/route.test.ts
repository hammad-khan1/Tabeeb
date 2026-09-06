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
  nextRequest,
} from '@/test/route-harness';
import { resetRateLimits } from '@/lib/rate-limit';
import { MAX_FILE_SIZE } from '@/lib/constants';

/**
 * The upload and list routes.
 *
 * Size and type limits used to live only in the upload page, so a direct POST bypassed
 * both entirely — the constants were imported by exactly one React component. These
 * assert the server enforces them, because that is the only place it matters.
 */

const describeIfDb = HAS_DATABASE ? describe : describe.skip;

function upload(file: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return nextRequest('http://t/api/documents', { method: 'POST', body: form });
}

function file(name: string, type: string, size = 32): File {
  const f = new File(['x'.repeat(size)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describeIfDb('POST /api/documents', () => {
  beforeAll(async () => {
    await seedUsers();
  });
  afterAll(async () => {
    await cleanup();
  });
  beforeEach(() => {
    resetRateLimits();
    enqueued.length = 0;
    actAs(USER_A);
  });

  it('accepts a supported file and queues it for processing', async () => {
    const { POST } = await import('./route');
    const response = await POST(upload(file('report.pdf', 'application/pdf')));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTruthy();
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].userId).toBe(USER_A);
  });

  it('rejects a file over the size limit', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      upload(file('huge.pdf', 'application/pdf', MAX_FILE_SIZE + 1))
    );
    expect(response.status).toBe(400);
    expect(enqueued).toHaveLength(0);
  });

  it('rejects an unsupported type', async () => {
    const { POST } = await import('./route');
    const response = await POST(upload(file('x.exe', 'application/x-msdownload')));
    expect(response.status).toBe(400);
  });

  it('rejects an empty file', async () => {
    const { POST } = await import('./route');
    expect((await POST(upload(file('e.pdf', 'application/pdf', 0)))).status).toBe(400);
  });

  it('rejects a request with no file at all', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      nextRequest('http://t/api/documents', { method: 'POST', body: new FormData() })
    );
    expect(response.status).toBe(400);
  });

  it('rejects an invalid document type rather than passing it to the enum column', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      upload(file('r.pdf', 'application/pdf'), { documentType: 'not_a_type' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects an unparseable date', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      upload(file('r.pdf', 'application/pdf'), { documentDate: 'yesterday' })
    );
    expect(response.status).toBe(400);
  });

  it('files the upload under the caller, whatever the form says', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      upload(file('r.pdf', 'application/pdf'), { userId: USER_B })
    );
    expect(response.status).toBe(201);
    expect(enqueued[0].userId).toBe(USER_A);
  });
});

describeIfDb('GET /api/documents', () => {
  beforeAll(async () => {
    await seedUsers();
    await seedDocument(USER_A, { title: "A's report" });
    await seedDocument(USER_B, { title: "B's report" });
  });
  afterAll(async () => {
    await cleanup();
  });
  beforeEach(() => {
    resetRateLimits();
    actAs(USER_A);
  });

  it("lists only the caller's documents", async () => {
    const { GET } = await import('./route');
    const body = await (await GET(nextRequest('http://t/api/documents'))).json();

    const titles = body.documents.map((d: { title: string }) => d.title);
    expect(titles).toContain("A's report");
    expect(titles).not.toContain("B's report");
  });

  it('does not return the extracted text in a list payload', async () => {
    // A list of documents should not carry every document's full OCR output.
    const { GET } = await import('./route');
    const body = await (await GET(nextRequest('http://t/api/documents'))).json();
    expect(body.documents[0]).not.toHaveProperty('rawExtractedText');
  });

  it('counts only the caller’s documents', async () => {
    const { GET } = await import('./route');
    const body = await (await GET(nextRequest('http://t/api/documents'))).json();
    expect(body.total).toBe(1);
  });

  it('rejects a non-numeric limit instead of silently returning nothing', async () => {
    const { GET } = await import('./route');
    const response = await GET(nextRequest('http://t/api/documents?limit=abc'));
    expect(response.status).toBe(400);
  });

  it('rejects a limit above the cap', async () => {
    const { GET } = await import('./route');
    expect((await GET(nextRequest('http://t/api/documents?limit=100000'))).status).toBe(400);
  });
});
