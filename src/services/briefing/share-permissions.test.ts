import { describe, expect, it, vi } from 'vitest';
import type { PatientBriefingData } from './types';

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://example.invalid' }));
vi.mock('./briefing-generator', () => ({ generatePatientBriefing: vi.fn() }));
const { filterBriefingForShare, BRIEFING_SECTIONS } = await import('./share');

function briefing(): PatientBriefingData {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    dateRange: { from: null, to: null, isCoveredAllTime: true },
    patient: { id: 'synthetic-owner', name: 'Synthetic Patient', email: 'synthetic@example.invalid', preferredLanguage: 'en' },
    clinicalSummary: 'PRIVATE_SUMMARY_WITH_MEDICINES',
    conditions: [{
      id: 'condition-a', condition: 'Selected condition', assertionStatus: 'present',
      diagnosingDoctor: 'PRIVATE_DOCTOR', hospital: 'PRIVATE_CLINIC',
      sourceDocumentId: 'doc-a', sourceDocumentTitle: 'PRIVATE_TITLE_WITH_MEDICINES',
    }],
    doctors: [{
      id: 'doctor-a', name: 'Selected Doctor', normalizedName: 'selected doctor',
      specialty: 'Selected specialty', hospital: 'Selected hospital', contactInfo: null,
      sourceType: 'patient_entered', isVerified: false, sourceDocumentId: 'doc-a',
      sourceDocumentTitle: 'PRIVATE_TITLE_WITH_MEDICINES', consultationDates: [],
      prescriptionsCount: 1, labOrdersCount: 1, notes: 'PRIVATE_NOTES_WITH_DIAGNOSIS',
    }],
    currentMedications: [{
      id: 'med-a', name: 'Selected medicine', genericName: null,
      dosage: 'PRIVATE_INSTRUCTIONS_WITH_DIAGNOSIS', frequency: 'daily', duration: null, route: 'oral',
      prescribedDate: null, status: 'active', useStatus: 'prescribed_unconfirmed',
      patientCorrections: { instructions: 'PRIVATE_CORRECTION_WITH_ALLERGY' },
      prescribingDoctor: { name: 'PRIVATE_DOCTOR', specialty: null, hospital: 'PRIVATE_CLINIC', role: 'prescribing', isIdentified: true },
      hospital: 'PRIVATE_CLINIC', sourceDocumentId: 'doc-a', sourceDocumentTitle: 'PRIVATE_TITLE_WITH_MEDICINES',
      sourceDocumentDate: null, sourceCitation: 'PRIVATE_CITATION_WITH_DIAGNOSIS',
    }],
    historicalMedications: [],
    allergies: [{
      allergen: 'Selected allergen', severity: 'severe', reaction: 'PRIVATE_REACTION_NARRATIVE_WITH_OTHER_MEDICINES',
      sourceDocumentId: 'doc-a', sourceDocumentTitle: 'PRIVATE_TITLE_WITH_DIAGNOSIS',
    }],
    recentLabResults: [{
      id: 'lab-a', testName: 'Selected test', canonicalTestName: null, value: '5',
      numericValue: 5, unit: 'synthetic unit', referenceRange: '1–10', isAbnormal: false,
      testDate: '2026-01-01', orderingDoctor: { name: 'PRIVATE_DOCTOR', specialty: 'PRIVATE_SPECIALTY', isIdentified: true },
      performingFacility: 'PRIVATE_CLINIC', sourceDocumentId: 'doc-a',
      sourceDocumentTitle: 'PRIVATE_TITLE_WITH_MEDICINES', sourceCitation: 'PRIVATE_CITATION_WITH_DIAGNOSIS',
    }],
    medicationSafety: {
      findings: [{
        id: 'finding-a', userId: 'synthetic-owner', category: 'conflicting_instructions',
        medicationIds: ['med-a'], title: 'Different documented instructions',
        explanation: 'PRIVATE_SOURCE_WORDING_WITH_ALLERGY', certainty: 'possible', severity: null,
        knowledgeSource: null, detectedAt: '2026-01-01T00:00:00.000Z',
        reviewStatus: 'needs_verification', resolutionNotes: 'PRIVATE_REVIEW_NOTE', current: true,
        evidence: [{ medicationId: 'med-a', documentId: 'doc-a', documentTitle: 'PRIVATE_SOURCE_TITLE',
          documentDate: '2026-01-01', page: null, excerpt: 'PRIVATE_SOURCE_EXCERPT', kind: 'document' }],
      }],
      timeline: [], evaluatedAt: '2026-01-01T00:00:00.000Z', limitations: [],
      interactionCoverage: { status: 'unavailable', provider: 'None configured', version: null,
        checkedAt: '2026-01-01T00:00:00.000Z', checkedPairs: 0, totalPairs: 0, limitations: [] },
    },
    labTrends: [], consultationsAndPlans: [], treatmentConflicts: [], uncertainties: [],
    consultationQuestions: [], doctorTimeline: [], citations: [], documentCount: 1, isPartial: false,
  };
}

describe('briefing section permission boundaries', () => {
  it('keeps selected conditions without leaking withheld clinician or source metadata', () => {
    const shared = filterBriefingForShare(briefing(), ['conditions']);
    expect(shared.conditions[0].condition).toBe('Selected condition');
    expect(shared.conditions[0].diagnosingDoctor).toBeNull();
    expect(shared.conditions[0].hospital).toBeNull();
    expect(JSON.stringify(shared)).not.toContain('PRIVATE_');
  });

  it('keeps selected lab facts without withheld clinician or source attribution', () => {
    const shared = filterBriefingForShare(briefing(), ['labs']);
    expect(shared.recentLabResults[0].value).toBe('5');
    expect(shared.recentLabResults[0].orderingDoctor.isIdentified).toBe(false);
    expect(shared.recentLabResults[0].performingFacility).toBeNull();
    expect(JSON.stringify(shared)).not.toContain('PRIVATE_');
  });

  it('removes doctor notes and source titles that can repeat withheld clinical facts', () => {
    const shared = filterBriefingForShare(briefing(), ['doctors']);
    expect(shared.doctors[0].name).toBe('Selected Doctor');
    expect(shared.doctors[0].notes).toBeNull();
    expect(shared.doctors[0].sourceDocumentTitle).toBeNull();
    expect(JSON.stringify(shared)).not.toContain('PRIVATE_');
  });

  it('preserves selected allergens and severity while withholding cross-section narratives', () => {
    const shared = filterBriefingForShare(briefing(), ['allergies']);
    expect(shared.allergies[0].allergen).toBe('Selected allergen');
    expect(shared.allergies[0].severity).toBe('severe');
    expect(shared.allergies[0].reaction).toContain('withheld');
    expect(JSON.stringify(shared)).not.toContain('PRIVATE_');
  });

  it('keeps medication finding categories without source prose, corrections or review notes', () => {
    const shared = filterBriefingForShare(briefing(), ['medications', 'conflicts']);
    expect(shared.currentMedications[0].name).toBe('Selected medicine');
    expect(shared.medicationSafety?.findings[0].category).toBe('conflicting_instructions');
    expect(shared.medicationSafety?.findings[0].resolutionNotes).toBeNull();
    expect(JSON.stringify(shared)).not.toContain('PRIVATE_');
  });

  it('preserves doctor attribution when both affected sections are explicitly selected', () => {
    const shared = filterBriefingForShare(briefing(), ['labs', 'conditions', 'doctors']);
    expect(shared.recentLabResults[0].orderingDoctor.name).toBe('PRIVATE_DOCTOR');
    expect(shared.conditions[0].diagnosingDoctor).toBe('PRIVATE_DOCTOR');
    expect(shared.doctors[0].notes).toBeNull();
    expect(shared.recentLabResults[0].sourceDocumentTitle).toBe('Source metadata withheld');
  });

  it('leaves fully authorized disclosures and original evidence unchanged', () => {
    const original = briefing();
    const before = structuredClone(original);
    filterBriefingForShare(original, ['medications']);
    expect(original).toEqual(before);
    expect(filterBriefingForShare(original, [...BRIEFING_SECTIONS])).toEqual(before);
    expect(filterBriefingForShare(original, [])).toEqual(before);
  });
});
