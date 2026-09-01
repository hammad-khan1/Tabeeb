import { describe, it, expect } from 'vitest';
import { chunkDocument } from './document-processor';

describe('chunkDocument', () => {
  const metadata = { documentType: 'lab_report', hospital: 'Aga Khan', date: '2024-06-15' };

  it('returns empty array for empty text', () => {
    expect(chunkDocument('', metadata)).toEqual([]);
    expect(chunkDocument('   ', metadata)).toEqual([]);
  });

  it('creates a single chunk for short text without sections', () => {
    const text = 'Patient visited the clinic today. Weight and height were recorded.';
    const chunks = chunkDocument(text, metadata);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].section).toBe('General');
    expect(chunks[0].content).toContain('[Document: lab_report');
    expect(chunks[0].content).toContain('Hospital: Aga Khan');
  });

  it('detects section boundaries and creates separate chunks', () => {
    const text = `Patient Name: John Doe

Medications
Metformin 500mg twice daily
Lisinopril 10mg once daily

Lab Results
Fasting Blood Sugar: 126 mg/dL
HbA1c: 6.5%

Diagnosis
Type 2 Diabetes Mellitus
Hypertension`;

    const chunks = chunkDocument(text, metadata);
    const sections = chunks.map(c => c.section);
    expect(sections).toContain('Medications');
    expect(sections).toContain('Lab Results');
    expect(sections).toContain('Diagnosis');
  });

  it('includes context header in every chunk', () => {
    const text = 'Medications\nAspirin 75mg daily\n\nDiagnosis\nCAD';
    const chunks = chunkDocument(text, metadata);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\[Document: lab_report/);
    }
  });

  it('computes token counts for each chunk', () => {
    const text = 'Some medical text here for testing purposes.';
    const chunks = chunkDocument(text, metadata);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('splits large sections into sub-chunks', () => {
    const longParagraph = 'Word '.repeat(1000); // ~5000 chars
    const text = `Medications\n${longParagraph}`;
    const chunks = chunkDocument(text, metadata);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(3200 + 200); // some tolerance for sentence breaks
    }
  });

  it('preserves content across sub-chunks without data loss', () => {
    const items = Array.from({ length: 50 }, (_, i) => `Drug${i} ${i * 10}mg daily`).join('\n');
    const text = `Medications\n${items}`;
    const chunks = chunkDocument(text, metadata);
    const combinedContent = chunks.map(c => c.content).join('\n');
    for (let i = 0; i < 50; i++) {
      expect(combinedContent).toContain(`Drug${i}`);
    }
  });

  it('handles multiple section types', () => {
    const text = `History
Patient complains of headaches for 3 months.

Vitals
BP: 140/90 mmHg
Pulse: 82 bpm

Examination
No neurological deficits observed.

Allergies
Penicillin - rash

Diagnosis
Migraine without aura
Hypertension stage 1`;

    const chunks = chunkDocument(text, metadata);
    const sections = new Set(chunks.map(c => c.section));
    expect(sections.size).toBeGreaterThanOrEqual(4);
  });
});
