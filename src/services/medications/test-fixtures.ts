import type { MedicationIdentity, MedicationRecord } from './types';

/** Entirely synthetic records, shared only by domain tests. */
export function identity(rxcui = '6809', name = 'metformin'): MedicationIdentity {
  return {
    status: 'verified', normalizedName: name, rxcui, conceptType: 'IN',
    ingredients: [{ rxcui, name }], provider: 'RxNorm', version: 'synthetic-test-version',
    checkedAt: '2026-01-01T00:00:00.000Z', limitations: [],
  };
}

export function medication(overrides: Partial<MedicationRecord> = {}): MedicationRecord {
  return {
    id: 'med-a', userId: 'synthetic-owner', documentId: 'doc-a', documentTitle: 'Synthetic prescription A',
    documentType: 'prescription', documentDate: '2026-01-01', createdAt: '2026-01-05T00:00:00.000Z',
    name: 'Metformin', genericName: null, dosage: '500 mg', frequency: 'twice daily',
    duration: null, route: 'oral', rxnormId: '6809', corrections: {}, patientStatus: null, sourceActive: true,
    observation: {
      originalName: 'Metformin', strength: '500', unit: 'mg', form: 'tablet', doseAmount: '1 tablet',
      status: 'prescribed_unconfirmed', confidence: 'documented',
      excerpt: 'Metformin 500 mg, 1 tablet orally twice daily.',
      instructions: '1 tablet orally twice daily', normalization: identity(),
    },
    ...overrides,
  };
}
