import { describe, expect, it } from 'vitest';
import { generateBriefingPdf } from './pdf-generator';
import type { AttributedMedication, PatientBriefingData } from './types';
import type { SafetyFinding } from '@/services/medications/types';

interface PdfText {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}
interface PdfPage {
  text: PdfText[];
  rectangles: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * Read the actual, uncompressed PDF drawing instructions. This checks emitted
 * page coordinates rather than reimplementing the layout's wrapping decisions.
 * It does not replace a visual font/glyph inspection.
 */
function pagesOf(pdf: Buffer): PdfPage[] {
  return [...pdf.toString('ascii').matchAll(/\nstream\n([\s\S]*?)\nendstream/g)].map(([, stream]) => ({
    text: [...stream.matchAll(/\/F[123] ([\d.]+) Tf\n1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\n\(((?:\\.|[^\\)])*)\) Tj/g)]
      .map(([, size, x, y, text]) => ({
        text: text.replace(/\\([\\()])/g, '$1'),
        x: Number(x), y: Number(y), fontSize: Number(size),
      })),
    rectangles: [...stream.matchAll(/(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+) re/g)]
      .map(([, x, y, width, height]) => ({ x: Number(x), y: Number(y), width: Number(width), height: Number(height) })),
  }));
}

function finding(index: number, explanation = 'The two source instructions differ. Verify these documented values with the clinician before changing treatment.'): SafetyFinding {
  return {
    id: `synthetic-finding-${index}`, userId: 'synthetic-owner',
    category: 'conflicting_instructions', medicationIds: ['synthetic-medication'],
    title: `Finding ${String(index).padStart(3, '0')} marker`,
    explanation, certainty: 'possible', severity: null,
    evidence: [{
      medicationId: 'synthetic-medication', documentId: 'synthetic-document',
      documentTitle: 'Synthetic prescription', documentDate: '2026-01', page: 2,
      excerpt: 'Synthetic instruction evidence.', kind: 'document',
    }],
    knowledgeSource: { provider: 'Synthetic verified terminology', version: '2026-test', url: null, checkedAt: '2026-01-02T00:00:00Z' },
    detectedAt: '2026-01-02T00:00:00Z', reviewStatus: 'needs_verification', resolutionNotes: null, current: true,
  };
}

function briefing(findings: SafetyFinding[]): PatientBriefingData {
  return {
    generatedAt: '2026-01-02T00:00:00Z',
    dateRange: { from: null, to: null, isCoveredAllTime: true },
    patient: { id: 'synthetic-owner', name: 'Synthetic Test Patient', email: 'synthetic@example.test', preferredLanguage: 'en' },
    clinicalSummary: 'Synthetic medication history prepared for review. Current use requires patient confirmation.',
    medicationSafety: {
      findings,
      timeline: [{
        id: 'synthetic-event', userId: 'synthetic-owner', type: 'frequency_change',
        medicationIds: ['synthetic-medication'], date: '2026-01',
        title: 'Documented frequency difference', description: 'Original source instructions are preserved; neither prescription is automatically preferred.',
        confirmation: 'needs_verification', evidence: findings[0]?.evidence ?? [],
      }],
      interactionCoverage: {
        status: 'unavailable', provider: 'No licensed interaction provider configured',
        version: null, checkedAt: '2026-01-02T00:00:00Z', checkedPairs: 0, totalPairs: 1,
        limitations: ['An unavailable check is not a negative interaction result.'],
      },
      limitations: ['Terminology matching does not establish interaction safety.'],
      evaluatedAt: '2026-01-02T00:00:00Z',
    },
    conditions: [], doctors: [], currentMedications: [], historicalMedications: [], allergies: [],
    recentLabResults: [], labTrends: [], consultationsAndPlans: [], treatmentConflicts: [],
    uncertainties: [], consultationQuestions: [], doctorTimeline: [],
    citations: [{
      index: 1, documentId: 'synthetic-document', documentTitle: 'Synthetic prescription',
      documentDate: '2026-01', documentType: 'prescription', pageNumber: 2,
      doctorName: null, doctorSpecialty: null, hospital: null,
      excerpt: 'Synthetic instruction evidence.', doctorAttributionEvidence: 'Prescriber not documented.',
    }],
    documentCount: 1, isPartial: false,
  };
}

function assertContentInBounds(pages: PdfPage[]) {
  expect(pages.length).toBeGreaterThan(0);
  for (const [index, page] of pages.entries()) {
    expect(page.text.length, `page ${index + 1} is not blank`).toBeGreaterThan(0);
    for (const item of page.text) {
      expect(item.x, `page ${index + 1}: ${item.text}`).toBeGreaterThanOrEqual(40);
      expect(item.x, `page ${index + 1}: ${item.text}`).toBeLessThan(572);
      // Footer text is deliberately below the 44pt body margin.
      const footer = item.y === 22 || item.y === 32;
      expect(item.y, `page ${index + 1}: ${item.text}`).toBeGreaterThanOrEqual(footer ? 20 : 44);
      expect(item.y + item.fontSize, `page ${index + 1}: ${item.text}`).toBeLessThanOrEqual(792);
    }
    for (const rectangle of page.rectangles) {
      expect(rectangle.y, `page ${index + 1}: row background`).toBeGreaterThanOrEqual(44);
      expect(rectangle.y + rectangle.height, `page ${index + 1}: row background`).toBeLessThanOrEqual(792);
      expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(612);
    }
  }
}

describe('medication safety PDF layout', () => {
  it('retains safety attribution, uncertainty, original citations and imprecise source dates', () => {
    const pages = pagesOf(generateBriefingPdf(briefing([finding(1)])));
    const text = pages.flatMap((page) => page.text.map((item) => item.text)).join(' ');
    expect(text).toContain('Drug interactions: unavailable');
    expect(text).toContain('not a negative interaction result');
    expect(text).toContain('possible');
    expect(text).toContain('needs verification');
    expect(text).toContain('2026-test');
    expect(text).toContain('[1]');
    expect(text).toContain('2026-01');
    expect(text).not.toContain('No interactions found');
    assertContentInBounds(pages);
  });

  it('repeats finding table headers on each continuation page without overlapping rows', () => {
    const findings = Array.from({ length: 48 }, (_, index) => finding(index + 1,
      `Evidence for synthetic finding ${index + 1}. ${'Verify the original dose, frequency and source date before a clinical decision. '.repeat(6)}`));
    const pages = pagesOf(generateBriefingPdf(briefing(findings)));
    const findingPages = pages.filter((page) => page.text.some((item) => /^Finding \d{3} marker$/.test(item.text)));
    expect(findingPages.length).toBeGreaterThan(2);
    for (const [index, page] of findingPages.entries()) {
      const headers = page.text.filter((item) => item.text === 'FINDING / CERTAINTY');
      expect(headers, `finding page ${index + 1} has exactly one header`).toHaveLength(1);
      const rows = page.text.filter((item) => /^Finding \d{3} marker$/.test(item.text));
      for (const row of rows) expect(headers[0].y - row.y).toBeGreaterThan(row.fontSize);
      const rowRanges = rows.map((row) => {
        const rectangle = page.rectangles.find((rect) => rect.x === 40 && rect.width === 532 && row.y >= rect.y && row.y < rect.y + rect.height);
        expect(rectangle, `row ${row.text} has an enclosing background`).toBeDefined();
        return rectangle!;
      });
      for (let row = 1; row < rowRanges.length; row++) {
        expect(rowRanges[row].y + rowRanges[row].height).toBeLessThanOrEqual(rowRanges[row - 1].y + 0.01);
      }
    }
    const renderedTitles = findingPages.flatMap((page) => page.text.filter((item) => /^Finding \d{3} marker$/.test(item.text)));
    expect(renderedTitles).toHaveLength(48);
    assertContentInBounds(pages);
  });

  it('splits a safety finding longer than one page without clipping or dropping explanation text', () => {
    const words = Array.from({ length: 780 }, (_, index) => `evidence${String(index).padStart(4, '0')}`);
    const pages = pagesOf(generateBriefingPdf(briefing([finding(1, words.join(' '))])));
    const explanationPages = pages.filter((page) => page.text.some((item) => /\bevidence\d{4}\b/.test(item.text)));
    expect(explanationPages.length).toBeGreaterThan(1);
    for (const page of explanationPages) {
      expect(page.text.filter((item) => item.text === 'FINDING / CERTAINTY')).toHaveLength(1);
    }
    const output = pages.flatMap((page) => page.text.map((item) => item.text)).join(' ');
    expect(output.match(/\bevidence\d{4}\b/g)).toEqual(words);
    assertContentInBounds(pages);
  });

  it('preserves original medication values and long patient corrections across table pages', () => {
    const data = briefing([]);
    const correctionWords = Array.from({ length: 450 }, (_, index) => `reported${String(index).padStart(4, '0')}`);
    const medication: AttributedMedication = {
      id: 'synthetic-medication', name: 'Synthetic medication', genericName: null, dosage: '500 mg',
      frequency: 'once daily', duration: null, route: 'oral', prescribedDate: null,
      status: 'active', useStatus: 'prescribed_unconfirmed',
      patientCorrections: { instructions: correctionWords.join(' ') },
      prescribingDoctor: { name: 'Not documented', specialty: null, hospital: null, role: 'prescribing', isIdentified: false },
      hospital: null, sourceDocumentId: 'synthetic-document', sourceDocumentTitle: 'Synthetic prescription',
      sourceDocumentDate: null, sourceCitation: '[1]', citationIndex: 1,
    };
    data.currentMedications = [medication];
    const pages = pagesOf(generateBriefingPdf(data));
    const text = pages.flatMap((page) => page.text.map((item) => item.text)).join(' ');
    expect(text).toContain('500 mg, once daily, oral');
    expect(text).toContain('Patient corrections:');
    expect(text).toContain('prescribed unconfirmed');
    expect(text.match(/\breported\d{4}\b/g)).toEqual(correctionWords);
    const medicationPages = pages.filter((page) => page.text.some((item) => /\breported\d{4}\b/.test(item.text)));
    expect(medicationPages.length).toBeGreaterThan(1);
    for (const page of medicationPages) expect(page.text.filter((item) => item.text === 'MEDICATION & GENERIC')).toHaveLength(1);
    assertContentInBounds(pages);
  });
});
