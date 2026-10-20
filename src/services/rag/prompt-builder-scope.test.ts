import { describe, it, expect } from 'vitest';
import { buildQaPrompt } from './prompt-builder';
import type { RetrievedChunk } from './retriever';

describe('buildQaPrompt Scope and Medication Safety Verification', () => {
  const dummyChunk: RetrievedChunk = {
    chunkId: 'chunk-1',
    content: 'Patient was prescribed Amoxicillin 500mg TID on 2026-05-10 for respiratory infection.',
    documentId: 'doc-1',
    documentTitle: 'Prescription Dr. Ahmed',
    documentType: 'prescription',
    section: 'Medications',
    relevanceScore: 0.88,
    matchedBy: ['dense'],
    matchedTerms: ['amoxicillin'],
  };

  it('clearly distinguishes confirmed current medications from unconfirmed prescriptions', () => {
    const userProfile = {
      medications: [
        {
          name: 'Metformin',
          dosage: '500mg',
          frequency: 'twice daily',
          status: 'confirmed_current',
        },
        {
          name: 'Amoxicillin',
          dosage: '500mg',
          frequency: 'three times daily',
          status: 'prescribed_unconfirmed',
          prescribedDate: '2026-05-10',
          sourceDocumentTitle: 'Prescription Dr. Ahmed',
        },
        {
          name: 'Lisinopril',
          status: 'discontinued',
        },
      ],
      allergies: [],
      conditions: ['Hypertension'],
    };

    const messages = buildQaPrompt(
      'What medications am I taking right now?',
      [dummyChunk],
      userProfile,
      [],
      { mode: 'latest', label: 'Latest Document: Prescription Dr. Ahmed' }
    );

    const systemPrompt = messages.find((m) => m.role === 'system')?.content || '';
    const userPrompt = messages.find((m) => m.role === 'user')?.content || '';

    // Verify system rules
    expect(systemPrompt).toContain('Prescriptions are NOT proof of current active consumption');
    expect(systemPrompt).toContain('Never state or imply that the patient is currently taking a medication unless explicitly confirmed');

    // Verify categorized patient context
    expect(userPrompt).toContain('Medications explicitly confirmed as currently taken by patient: Metformin');
    expect(userPrompt).toContain('Medications documented as prescribed (patient current-use unconfirmed): Amoxicillin');
    expect(userPrompt).toContain('Discontinued medications: Lisinopril');
    expect(userPrompt).toContain('Active Search Scope: Latest Document: Prescription Dr. Ahmed');
  });

  it('includes scope adherence and insufficient evidence instructions in system prompt', () => {
    const messages = buildQaPrompt(
      'What were my lipid panel values?',
      [dummyChunk],
      { medications: [], allergies: [], conditions: [] },
      [],
      { mode: 'specific', label: 'Chest X-Ray Report' }
    );

    const systemPrompt = messages.find((m) => m.role === 'system')?.content || '';
    expect(systemPrompt).toContain('Scope Adherence & Insufficient Evidence');
    expect(systemPrompt).toContain('I couldn\'t find information answering that in your selected document(s)');
  });
});
