import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isLikelyFollowUp,
  isExplicitAllHistoryRequest,
  isExplicitLatestPrescriptionRequest,
  isExplicitLatestLabRequest,
  isExplicitLatestDocumentRequest,
  isExplicitCompareRequest,
  isMateriallyAmbiguousQuestion,
  resolveSourceScope,
} from './source-scope-resolver';

// Mock getDb
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: mockSelect,
  }),
}));

describe('SourceScopeResolver Pattern Recognition', () => {
  it('correctly identifies explicit all-history queries', () => {
    expect(isExplicitAllHistoryRequest('Have I ever been prescribed amoxicillin?')).toBe(true);
    expect(isExplicitAllHistoryRequest('Show all my medications over time')).toBe(true);
    expect(isExplicitAllHistoryRequest('What is my complete medical history?')).toBe(true);
    expect(isExplicitAllHistoryRequest('What are my current medications?')).toBe(false);
  });

  it('correctly identifies explicit latest prescription queries', () => {
    expect(isExplicitLatestPrescriptionRequest('What medicines are listed in my latest prescription?')).toBe(true);
    expect(isExplicitLatestPrescriptionRequest('Show my most recent rx')).toBe(true);
    expect(isExplicitLatestPrescriptionRequest('What is my blood pressure?')).toBe(false);
  });

  it('correctly identifies explicit latest lab queries', () => {
    expect(isExplicitLatestLabRequest('What were the results of my latest blood test?')).toBe(true);
    expect(isExplicitLatestLabRequest('Show my last lab report')).toBe(true);
    expect(isExplicitLatestLabRequest('What about my dosage?')).toBe(false);
  });

  it('correctly identifies explicit latest document queries', () => {
    expect(isExplicitLatestDocumentRequest('What did the doctor write in my latest document?')).toBe(true);
    expect(isExplicitLatestDocumentRequest('Check my newest upload')).toBe(true);
    expect(isExplicitLatestDocumentRequest('Have I ever taken aspirin?')).toBe(false);
  });

  it('correctly identifies explicit comparison queries', () => {
    const compLabs = isExplicitCompareRequest('Compare my last two blood tests');
    expect(compLabs.isCompare).toBe(true);
    expect(compLabs.type).toBe('lab_report');

    const compMeds = isExplicitCompareRequest('Now compare it with my previous prescription');
    expect(compMeds.isCompare).toBe(true);
    expect(compMeds.type).toBe('prescription');

    const notComp = isExplicitCompareRequest('What did the doctor prescribe?');
    expect(notComp.isCompare).toBe(false);
  });

  it('correctly detects follow-up questions', () => {
    expect(isLikelyFollowUp('What about the dosage?')).toBe(true);
    expect(isLikelyFollowUp('And the frequency?')).toBe(true);
    expect(isLikelyFollowUp('Why did he prescribe it?')).toBe(true);
    expect(isLikelyFollowUp('Is that safe?')).toBe(true);
    expect(isLikelyFollowUp('What medications am I taking right now?')).toBe(false);
  });

  it('identifies materially ambiguous questions that require scope clarification', () => {
    expect(isMateriallyAmbiguousQuestion('What medications am I taking right now?')).toBe(true);
    expect(isMateriallyAmbiguousQuestion('What are my current medications?')).toBe(true);
    expect(isMateriallyAmbiguousQuestion('What did the doctor prescribe?')).toBe(true);
    expect(isMateriallyAmbiguousQuestion('What medicines are listed in my latest prescription?')).toBe(false);
    expect(isMateriallyAmbiguousQuestion('Have I ever been prescribed amoxicillin?')).toBe(false);
  });
});

describe('resolveSourceScope Workflow & Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  });

  it('returns unavailable reason if patient has no uploaded documents', async () => {
    mockOrderBy.mockResolvedValue([]);

    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'What medications am I taking?',
    });

    expect(result.unavailableReason).toContain('have not uploaded any medical documents yet');
    expect(result.mode).toBe('all');
  });

  it('triggers clarification for ambiguous questions when patient has multiple documents and no established scope', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'doc_1',
        title: 'Prescription June 2026',
        documentType: 'prescription',
        extractionStatus: 'completed',
        createdAt: new Date('2026-06-01'),
        documentDate: new Date('2026-06-01'),
      },
      {
        id: 'doc_2',
        title: 'Discharge Summary Jan 2026',
        documentType: 'discharge_summary',
        extractionStatus: 'completed',
        createdAt: new Date('2026-01-01'),
        documentDate: new Date('2026-01-01'),
      },
    ]);

    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'What medications am I taking right now?',
    });

    expect(result.clarification).toBeDefined();
    expect(result.clarification?.question).toContain('Would you like me to check your latest uploaded document or your complete medication history?');
    expect(result.clarification?.options).toHaveLength(3);
    expect(result.clarification?.options[0].mode).toBe('latest');
    expect(result.clarification?.options[1].mode).toBe('all');
    expect(result.clarification?.options[2].mode).toBe('specific');
  });

  it('does NOT trigger clarification when patient has only one document in total', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'doc_single',
        title: 'Only Document',
        documentType: 'prescription',
        extractionStatus: 'completed',
        createdAt: new Date('2026-06-01'),
        documentDate: new Date('2026-06-01'),
      },
    ]);

    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'What medications am I taking right now?',
    });

    expect(result.clarification).toBeUndefined();
    expect(result.documentIds).toEqual(['doc_single']);
    expect(result.mode).toBe('latest');
  });

  it('handles explicit "latest prescription" request without clarification', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'doc_lab',
        title: 'Recent Blood Test',
        documentType: 'lab_report',
        extractionStatus: 'completed',
        createdAt: new Date('2026-06-10'),
      },
      {
        id: 'doc_rx',
        title: 'Cardiology Prescription',
        documentType: 'prescription',
        extractionStatus: 'completed',
        createdAt: new Date('2026-06-01'),
      },
    ]);

    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'What medicines are listed in my latest prescription?',
    });

    expect(result.clarification).toBeUndefined();
    expect(result.documentIds).toEqual(['doc_rx']);
    expect(result.label).toContain('Latest Prescription');
  });

  it('communicates processing state when latest document is still processing instead of silently switching', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'doc_processing',
        title: 'New Upload.pdf',
        documentType: 'prescription',
        extractionStatus: 'processing',
        createdAt: new Date('2026-06-15'),
      },
      {
        id: 'doc_old',
        title: 'Old Prescription.pdf',
        documentType: 'prescription',
        extractionStatus: 'completed',
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'Check my latest prescription',
      requestedScope: { mode: 'latest' },
    });

    expect(result.unavailableReason).toBeDefined();
    expect(result.unavailableReason).toContain('is currently being processed');
    // Does NOT silently switch to doc_old
    expect(result.documentIds).toEqual(['doc_processing']);
  });

  it('inherits scope across conversational follow-up turns', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'doc_rx1',
        title: 'Dr. Khan Prescription',
        documentType: 'prescription',
        extractionStatus: 'completed',
        createdAt: new Date('2026-06-01'),
      },
      {
        id: 'doc_other',
        title: 'Hospital Discharge',
        documentType: 'discharge_summary',
        extractionStatus: 'completed',
        createdAt: new Date('2026-01-01'),
      },
    ]);

    // Follow-up question referring to previous turn's document
    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'What about the dosage?',
      priorTurns: [
        { role: 'user', content: 'Show medications from my latest prescription' },
        { role: 'assistant', content: 'You were prescribed Metformin 500mg.' },
      ],
      priorTurnSources: [{ documentId: 'doc_rx1', documentTitle: 'Dr. Khan Prescription' }],
    });

    expect(result.clarification).toBeUndefined();
    expect(result.documentIds).toEqual(['doc_rx1']);
    expect(result.label).toBe('Dr. Khan Prescription');
  });

  it('expands scope when follow-up explicitly requests multi-document comparison', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'doc_rx2',
        title: 'Latest Prescription June',
        documentType: 'prescription',
        extractionStatus: 'completed',
        createdAt: new Date('2026-06-01'),
      },
      {
        id: 'doc_rx1',
        title: 'Previous Prescription March',
        documentType: 'prescription',
        extractionStatus: 'completed',
        createdAt: new Date('2026-03-01'),
      },
    ]);

    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'Now compare it with my previous prescription',
      priorTurns: [
        { role: 'user', content: 'What is the dosage in my latest prescription?' },
        { role: 'assistant', content: 'Metformin 850mg.' },
      ],
      priorTurnSources: [{ documentId: 'doc_rx2', documentTitle: 'Latest Prescription June' }],
    });

    expect(result.documentIds).toEqual(['doc_rx2', 'doc_rx1']);
    expect(result.label).toContain('Comparison: Latest Prescription June & Previous Prescription March');
  });

  it('enforces patient authorization: filters out document IDs not belonging to user', async () => {
    mockOrderBy.mockResolvedValue([
      {
        id: 'doc_owned',
        title: 'My Document',
        documentType: 'lab_report',
        extractionStatus: 'completed',
        createdAt: new Date('2026-06-01'),
      },
    ]);

    // Client maliciously passes document ID belonging to another user
    const result = await resolveSourceScope({
      userId: 'user_123',
      message: 'Summarize this document',
      requestedScope: { mode: 'specific', documentIds: ['doc_unauthorized_victim'] },
    });

    expect(result.unavailableReason).toContain('could not be found or you do not have permission');
  });
});
