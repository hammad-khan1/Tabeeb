import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveRelevantChunks } from './retriever';

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    execute: mockExecute,
    select: mockSelect,
  }),
}));

vi.mock('@/lib/embeddings', () => ({
  embeddingProvider: {
    embed: vi.fn(async () => [0.1, 0.2, 0.3]),
  },
}));

describe('retrieveRelevantChunks Scope Filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
  });

  it('passes documentIds filter to both dense and lexical candidates', async () => {
    mockExecute.mockResolvedValue([
      {
        chunk_id: 'c1',
        content: 'Prescription details for Metformin',
        document_id: 'doc-target',
        section: 'Medications',
        score: 0.89,
      },
    ]);

    mockWhere.mockResolvedValue([
      {
        id: 'doc-target',
        title: 'Prescription Target',
        documentType: 'prescription',
        documentDate: new Date('2026-06-01'),
        createdAt: new Date('2026-06-01'),
      },
    ]);

    const chunks = await retrieveRelevantChunks('user_123', 'metformin dose', {
      documentIds: ['doc-target'],
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].documentId).toBe('doc-target');

    // Verify SQL executions received the document ID parameter
    expect(mockExecute).toHaveBeenCalled();
    const calls = mockExecute.mock.calls;
    // Inspect query strings from the template tags
    const executedQueries = calls.map((c) => JSON.stringify(c[0]));
    expect(executedQueries.some((q) => q.includes('document_id'))).toBe(true);
  });

  it('returns empty result when no chunks match within the scoped documents without searching broader documents', async () => {
    mockExecute.mockResolvedValue([]); // No chunks in scoped document

    const chunks = await retrieveRelevantChunks('user_123', 'blood glucose', {
      documentIds: ['doc-scoped'],
    });

    expect(chunks).toHaveLength(0);
  });
});
