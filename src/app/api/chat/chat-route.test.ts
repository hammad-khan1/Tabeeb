import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetCurrentUserId = vi.fn();
const mockConsume = vi.fn();
const mockRetrieveRelevantChunks = vi.fn();
const mockStreamAnswer = vi.fn();
const mockResolveSourceScope = vi.fn();

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
  AuthError: class AuthError extends Error {
    constructor() {
      super('Not authenticated');
      this.name = 'AuthError';
    }
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  consume: () => mockConsume(),
  RateLimitError: class RateLimitError extends Error {},
}));

vi.mock('@/services/rag/retriever', () => ({
  retrieveRelevantChunks: (...args: unknown[]) => mockRetrieveRelevantChunks(...args),
}));

vi.mock('@/services/rag/answer-streamer', () => ({
  streamAnswer: (...args: unknown[]) => mockStreamAnswer(...args),
}));

vi.mock('@/services/rag/query-rewriter', () => ({
  rewriteForRetrieval: vi.fn(async (msg: string) => msg),
}));

vi.mock('@/services/rag/source-scope-resolver', () => ({
  resolveSourceScope: (...args: unknown[]) => mockResolveSourceScope(...args),
}));

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) });
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockLeftJoin = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    insert: mockInsert,
    select: mockSelect,
  }),
}));

import { POST } from './route';

describe('Chat API Route Scoping & Streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('user_test_123');
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere, leftJoin: mockLeftJoin });
    mockLeftJoin.mockReturnValue({ where: mockWhere });
    mockWhere.mockImplementation(() => {
      const p = Promise.resolve([{ count: 1, latest: '2026-01-01' }]);
      return Object.assign(p, {
        orderBy: mockOrderBy,
        limit: mockLimit,
      });
    });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
  });

  it('returns 400 when message is missing or empty', async () => {
    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('streams clarification event and options when question is ambiguous', async () => {
    mockResolveSourceScope.mockResolvedValue({
      mode: 'auto',
      label: 'Clarification Needed',
      clarification: {
        question: 'Would you like me to check your latest uploaded document or your complete medication history?',
        options: [
          { label: 'Latest uploaded document', mode: 'latest' },
          { label: 'Complete medical history', mode: 'all' },
          { label: 'Choose a specific document', mode: 'specific' },
        ],
        originalQuestion: 'What medications am I taking right now?',
      },
    });

    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What medications am I taking right now?',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const bodyText = await res.text();
    expect(bodyText).toContain('clarification');
    expect(bodyText).toContain('Would you like me to check your latest uploaded document');
    expect(bodyText).toContain('data: [DONE]');
  });

  it('communicates unavailable document reason without attempting stream generation', async () => {
    mockResolveSourceScope.mockResolvedValue({
      mode: 'latest',
      label: 'Latest Document: Scan.pdf',
      unavailableReason: 'Your latest document ("Scan.pdf") is currently being processed. Please wait a moment.',
    });

    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is my dose?',
        scope: { mode: 'latest' },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).toContain('is currently being processed');
    expect(mockStreamAnswer).not.toHaveBeenCalled();
  });

  it('filters retrieval by documentIds when scoped search is resolved', async () => {
    mockResolveSourceScope.mockResolvedValue({
      mode: 'specific',
      documentIds: ['a0000000-0000-4000-a000-000000000001'],
      documentTitles: ['Cardiology Prescription'],
      label: 'Cardiology Prescription',
    });

    mockRetrieveRelevantChunks.mockResolvedValue([
      {
        chunkId: 'c1',
        content: 'Metformin 500mg PO daily',
        documentId: 'a0000000-0000-4000-a000-000000000001',
        documentTitle: 'Cardiology Prescription',
        documentType: 'prescription',
        section: 'Medications',
        relevanceScore: 0.95,
        matchedBy: ['dense'],
        matchedTerms: ['metformin'],
      },
    ]);

    async function* dummyStream() {
      yield { choices: [{ delta: { content: 'You were prescribed Metformin 500mg.' } }] };
    }
    mockStreamAnswer.mockResolvedValue(dummyStream());

    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What did the doctor prescribe in this report?',
        scope: { mode: 'specific', documentIds: ['a0000000-0000-4000-a000-000000000001'] },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockRetrieveRelevantChunks).toHaveBeenCalledWith(
      'user_test_123',
      'What did the doctor prescribe in this report?',
      { documentIds: ['a0000000-0000-4000-a000-000000000001'] }
    );

    const bodyText = await res.text();
    expect(bodyText).toContain('You were prescribed Metformin 500mg.');
    expect(bodyText).toContain('"mode":"specific"');
    expect(bodyText).toContain('"documentIds":["a0000000-0000-4000-a000-000000000001"]');
  });

  it('returns explicit insufficient evidence message when scoped search yields 0 chunks and 0 records', async () => {
    mockResolveSourceScope.mockResolvedValue({
      mode: 'specific',
      documentIds: ['a0000000-0000-4000-a000-000000000002'],
      documentTitles: ['Foot Ultrasound'],
      label: 'Foot Ultrasound',
    });

    mockRetrieveRelevantChunks.mockResolvedValue([]); // 0 chunks

    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What was my cholesterol level?',
        scope: { mode: 'specific', documentIds: ['a0000000-0000-4000-a000-000000000002'] },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).toContain("couldn't find any information answering your question in Foot Ultrasound");
    expect(bodyText).toContain('Complete Medical History');
    // Ensure Groq stream was not called
    expect(mockStreamAnswer).not.toHaveBeenCalled();
  });
});
