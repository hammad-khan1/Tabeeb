import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStructuredExtraction } from '@/services/extraction-schema';
import { extractionMedicationCorrections } from '@/services/document-processor';
import {
  documentedMedicationStatus, medicationExcerpt, medicationSourceKeys, prepareMedicationRows,
} from './observations';
import { normalizeMedicationIdentity } from './normalization';

vi.mock('./normalization', () => ({ normalizeMedicationIdentity: vi.fn() }));

const verified = {
  status: 'verified' as const, normalizedName: 'metformin', rxcui: '6809', conceptType: 'IN',
  ingredients: [{ name: 'metformin', rxcui: '6809' }],
  provider: 'RxNorm' as const, version: 'synthetic-v1', checkedAt: '2026-01-01T00:00:00Z', limitations: [],
};
beforeEach(() => {
  vi.mocked(normalizeMedicationIdentity).mockReset().mockResolvedValue(verified);
});

describe('source medication observations', () => {
  it('preserves raw brand/formulation details while discarding model identifiers', async () => {
    const data = parseStructuredExtraction({ medications: [{
      name: 'Glucophage XR', genericName: 'metformin', dosage: '500 mg',
      strength: '500', unit: 'mg', form: 'extended-release tablet', doseAmount: 'one tablet',
      frequency: 'once daily', route: 'oral', rxnormId: 'untrusted-model-id', isActive: true,
      excerpt: 'Glucophage XR 500 mg one tablet once daily oral', sourcePage: 99,
    }] });
    const [row] = await prepareMedicationRows({
      documentId: 'source', userId: 'owner', data,
      text: 'Glucophage XR 500 mg one tablet once daily oral',
      documentDate: null, lowConfidence: false,
    });
    expect(row.name).toBe('Glucophage XR');
    expect(row.rxnormId).toBe('6809');
    expect(row.observation).toMatchObject({
      originalName: 'Glucophage XR', form: 'extended-release tablet',
      doseAmount: 'one tablet', status: 'prescribed_unconfirmed', sourcePage: null,
    });
    expect(normalizeMedicationIdentity).toHaveBeenCalledWith('Glucophage XR');
  });

  it('keeps missing strength, date, and unresolved names without inventing values', async () => {
    vi.mocked(normalizeMedicationIdentity).mockResolvedValue({
      ...verified, status: 'unresolved', normalizedName: null, rxcui: null, ingredients: [],
    });
    const [row] = await prepareMedicationRows({
      documentId: 'source', userId: 'owner',
      data: parseStructuredExtraction({ medications: [{ name: 'UnknownBrand', startDate: 'around March 2025', prescribedDate: '2024-05' }] }),
      text: 'UnknownBrand', documentDate: null, lowConfidence: false,
    });
    expect(row.observation).toMatchObject({ strength: null, startDate: 'around March 2025', prescribedDateText: '2024-05' });
    expect(row.prescribedDate).toBeNull();
    expect(row.rxnormId).toBeNull();
  });

  it('does not normalize low-confidence or unsupported excerpts', async () => {
    const [row] = await prepareMedicationRows({
      documentId: 'source', userId: 'owner',
      data: parseStructuredExtraction({ medications: [{ name: 'Metformin', excerpt: 'invented quote' }] }),
      text: 'Unrelated source text', documentDate: null, lowConfidence: true,
    });
    expect(row.observation).toMatchObject({ excerpt: null, confidence: 'uncertain', status: 'unknown' });
    expect(normalizeMedicationIdentity).not.toHaveBeenCalled();
  });

  it('does not require a duration merely because the indication follows “for”', async () => {
    const [row] = await prepareMedicationRows({
      documentId: 'source', userId: 'owner',
      data: parseStructuredExtraction({ medications: [{
        name: 'Metformin', instructions: 'Metformin for diabetes', durationExpected: true,
      }] }),
      text: 'Metformin for diabetes', documentDate: null, lowConfidence: false,
    });
    expect(row.observation.durationExpected).toBe(false);
  });

  it('does not treat active=true or model status as patient confirmation', () => {
    expect(documentedMedicationStatus({ name: 'Metformin', isActive: true }, 'Metformin 500 mg', false))
      .toBe('prescribed_unconfirmed');
  });

  it('requires medication-specific, unconditional stop instructions', () => {
    const warfarin = { name: 'warfarin' };
    expect(documentedMedicationStatus(warfarin, 'Stop warfarin; start aspirin', false)).toBe('discontinued');
    expect(documentedMedicationStatus({ name: 'aspirin' }, 'Stop warfarin; start aspirin', false)).toBe('prescribed_unconfirmed');
    for (const text of ['Do not stop warfarin', 'Stop warfarin if rash develops', 'Stop warfarin after five days']) {
      expect(documentedMedicationStatus(warfarin, text, false)).toBe('prescribed_unconfirmed');
    }
    expect(documentedMedicationStatus({ ...warfarin, explicitStop: true }, 'warfarin 5 mg', false)).toBe('unknown');
  });

  it('uses only text that actually exists as the source quote', () => {
    expect(medicationExcerpt({ name: 'Aspirin', excerpt: 'invented dose' }, 'Aspirin 75 mg\nother line')).toBe('Aspirin 75 mg');
    expect(medicationExcerpt({ name: 'Aspirin', excerpt: 'Patient follow-up' }, 'Patient follow-up')).toBeNull();
    expect(medicationExcerpt({ name: 'Met' }, 'Metformin 500 mg')).toBeNull();
  });

  it('only treats a source-target replacement as documented when unconditional', () => {
    const medicine = { name: 'warfarin', explicitReplacement: 'apixaban' };
    expect(documentedMedicationStatus(medicine, 'Replace warfarin with apixaban', false)).toBe('changed');
    expect(documentedMedicationStatus(medicine, 'Consider switching warfarin to apixaban', false)).toBe('unknown');
    expect(documentedMedicationStatus({ name: 'aspirin', explicitReplacement: 'apixaban' }, 'Replace warfarin with apixaban; aspirin daily', false)).toBe('unknown');
  });

  it('keeps source keys stable on reorder, including same-name strength variants', () => {
    const original = [{ name: 'Metformin', dosage: '500 mg' }, { name: 'Metformin', dosage: '1000 mg' }, { name: 'Aspirin' }];
    const keys = medicationSourceKeys(original);
    expect(medicationSourceKeys([...original].reverse())).toEqual([...keys].reverse());
    expect(medicationSourceKeys([{ name: 'Aspirin', dosage: '75 mg' }]))
      .toEqual(medicationSourceKeys([{ name: 'Aspirin', dosage: '100 mg' }]));
    expect(new Set(medicationSourceKeys([{ name: 'Aspirin' }, { name: 'Aspirin' }])).size).toBe(2);
  });

  it('fingerprints the whole source independently of document ID, rather than the medication alone', async () => {
    const data = parseStructuredExtraction({ medications: [{ name: 'Metformin', dosage: '500 mg' }] });
    const prepare = (documentId: string, text: string) => prepareMedicationRows({
      documentId, userId: 'owner', data, text, documentDate: null, lowConfidence: false,
    });
    const [original] = await prepare('original', 'Clinic A\n2026-01-01\nMetformin 500 mg');
    const [copy] = await prepare('copy', 'Clinic A\n2026-01-01\nMetformin 500 mg');
    const [differentPrescription] = await prepare('other', 'Clinic B\n2026-02-01\nMetformin 500 mg');
    expect(original.observation.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(copy.observation.sourceFingerprint).toBe(original.observation.sourceFingerprint);
    expect(differentPrescription.observation.sourceFingerprint).not.toBe(original.observation.sourceFingerprint);
  });

  it('uses an actual source page marker rather than the model-supplied page number', async () => {
    const [row] = await prepareMedicationRows({
      documentId: 'source', userId: 'owner',
      data: parseStructuredExtraction({ medications: [{
        name: 'Metformin', dosage: '500 mg', excerpt: 'Metformin 500 mg', sourcePage: 99,
      }] }),
      text: '[Page 1]\nSynthetic history\n[Page 2]\nMetformin 500 mg',
      documentDate: null, lowConfidence: false,
    });
    expect(row.observation.sourcePage).toBe(2);
  });

  it('preserves original extraction values when the patient corrects directions', () => {
    const original = [{ name: 'Metformin', dosage: '500 mg', frequency: 'daily' }];
    const edits = [{ name: 'Metformin', dosage: '850 mg', frequency: 'twice daily' }];
    expect(extractionMedicationCorrections(original, edits)).toEqual([{
      index: 0, corrections: { dosage: '850 mg', frequency: 'twice daily' },
    }]);
    expect(original[0].dosage).toBe('500 mg');
    expect(() => extractionMedicationCorrections(original, [])).toThrow('additions/removals');
  });
});
