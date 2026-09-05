import { describe, expect, it, vi, beforeEach } from 'vitest';
import { parseStructuredExtraction } from '@/services/extraction-schema';
import type { MedicalEntity } from './medical-ner';

const extractMedicalEntities = vi.fn<(text: string) => Promise<MedicalEntity[]>>();
const normalizeDrugNames = vi.fn();

vi.mock('./medical-ner', () => ({
  extractMedicalEntities: (text: string) => extractMedicalEntities(text),
}));

vi.mock('./drug-normalizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./drug-normalizer')>();
  return {
    ...actual,
    normalizeDrugNames: (names: string[]) => normalizeDrugNames(names),
  };
});

const { reconcileExtraction } = await import('./reconciler');

function entity(text: string, type: MedicalEntity['type'], score = 0.9): MedicalEntity {
  return { text, type, score, source: 'rules' };
}

beforeEach(() => {
  extractMedicalEntities.mockReset();
  normalizeDrugNames.mockReset();
  normalizeDrugNames.mockImplementation(async (names: string[]) =>
    names.map((name) => ({ name, rxcui: undefined, corrected: false, original: name }))
  );
});

describe('reconcileExtraction', () => {
  it('does not report an allergen as a missed medication', async () => {
    const extraction = parseStructuredExtraction({
      medications: [{ name: 'Tab. Metformin', dosage: '850 mg' }],
      allergies: [{ allergen: 'PENICILLIN' }],
    });

    extractMedicalEntities.mockResolvedValue([
      entity('Metformin', 'medication'),
      entity('PENICILLIN', 'medication'),
    ]);

    const result = await reconcileExtraction('...', extraction);

    expect(result.missedEntities).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it('reports a genuinely missing medication without adding it to the record', async () => {
    const extraction = parseStructuredExtraction({
      medications: [{ name: 'Metformin' }],
    });

    extractMedicalEntities.mockResolvedValue([
      entity('Metformin', 'medication'),
      entity('Atorvastatin', 'medication'),
    ]);

    const result = await reconcileExtraction('...', extraction);

    expect(result.missedEntities.map((e) => e.text)).toEqual(['Atorvastatin']);
    expect(result.notes.join(' ')).toContain('Atorvastatin');
    expect(result.extraction.medications).toHaveLength(1);
  });

  it('ignores low-confidence entities', async () => {
    const extraction = parseStructuredExtraction({ medications: [] });

    extractMedicalEntities.mockResolvedValue([entity('Atorvastatin', 'medication', 0.4)]);

    const result = await reconcileExtraction('...', extraction);

    expect(result.missedEntities).toEqual([]);
  });

  it('records the RxNorm identification in the notes without rewriting the name', async () => {
    const extraction = parseStructuredExtraction({
      medications: [{ name: 'Metformim' }],
    });

    extractMedicalEntities.mockResolvedValue([]);
    normalizeDrugNames.mockResolvedValue([
      { name: 'metformin', rxcui: '6809', corrected: true, original: 'Metformim' },
    ]);

    const result = await reconcileExtraction('...', extraction);

    expect(result.extraction.medications[0].rxnormId).toBe('6809');
    expect(result.extraction.medications[0].genericName).toBe('metformin');
    // The verbatim reading survives — it is what the patient can check against the paper.
    expect(result.extraction.medications[0].name).toBe('Metformim');
    expect(result.identifiedDrugCount).toBe(1);
    expect(result.notes.join(' ')).toContain('RxNorm');
    // The note must not claim a correction the code does not make.
    expect(result.notes.join(' ')).not.toContain('corrected');
  });

  it('does not overwrite a generic name the model already supplied', async () => {
    const extraction = parseStructuredExtraction({
      medications: [{ name: 'Glucophage', genericName: 'Metformin HCl' }],
    });

    extractMedicalEntities.mockResolvedValue([]);
    normalizeDrugNames.mockResolvedValue([
      { name: 'metformin', rxcui: '6809', corrected: false, original: 'Glucophage' },
    ]);

    const result = await reconcileExtraction('...', extraction);

    expect(result.extraction.medications[0].genericName).toBe('Metformin HCl');
    expect(result.extraction.medications[0].rxnormId).toBe('6809');
  });

  it('reports a condition the extraction missed but not one it captured', async () => {
    const extraction = parseStructuredExtraction({
      diagnoses: [{ condition: 'Type 2 Diabetes Mellitus' }],
    });

    extractMedicalEntities.mockResolvedValue([
      entity('type 2 diabetes', 'condition'),
      entity('hypertension', 'condition'),
    ]);

    const result = await reconcileExtraction('...', extraction);

    expect(result.missedEntities.map((e) => e.text)).toEqual(['hypertension']);
  });
});

describe('clinical context', () => {
  it('marks a denied condition so it never reaches the health record', async () => {
    const extraction = parseStructuredExtraction({
      diagnoses: [{ condition: 'diabetes' }],
    });
    extractMedicalEntities.mockResolvedValue([]);

    const result = await reconcileExtraction('No history of diabetes.', extraction);

    expect(result.extraction.diagnoses[0].assertionStatus).toBe('absent');
    expect(result.heldBack.map((a) => a.term)).toEqual(['diabetes']);
    expect(result.notes.join(' ')).toContain('do not have it');
  });

  it('keeps a condition the document states plainly', async () => {
    const extraction = parseStructuredExtraction({
      diagnoses: [{ condition: 'hypertension' }],
    });
    extractMedicalEntities.mockResolvedValue([]);

    const result = await reconcileExtraction(
      'Patient has hypertension, on amlodipine.',
      extraction
    );

    expect(result.extraction.diagnoses[0].assertionStatus).toBe('present');
    expect(result.heldBack).toEqual([]);
  });

  it('attributes a relative’s condition to the family', async () => {
    const extraction = parseStructuredExtraction({
      diagnoses: [{ condition: 'asthma' }],
    });
    extractMedicalEntities.mockResolvedValue([]);

    const result = await reconcileExtraction('Family history of asthma.', extraction);

    expect(result.extraction.diagnoses[0].assertionStatus).toBe('family');
  });

  it('does not read "no known drug allergies" as an allergy', async () => {
    const extraction = parseStructuredExtraction({
      allergies: [{ allergen: 'drug' }],
    });
    extractMedicalEntities.mockResolvedValue([]);

    const result = await reconcileExtraction('No known drug allergies.', extraction);

    expect(result.extraction.allergies[0].assertionStatus).toBe('absent');
  });

  it('fills in an ICD-10 code the document did not print', async () => {
    const extraction = parseStructuredExtraction({
      diagnoses: [{ condition: 'T2DM' }, { condition: 'CKD', icd10Code: 'N18.3' }],
    });
    extractMedicalEntities.mockResolvedValue([]);

    const result = await reconcileExtraction('Known case of T2DM and CKD.', extraction);

    expect(result.extraction.diagnoses[0].icd10Code).toBe('E11.9');
    // A code the document printed itself is never overwritten.
    expect(result.extraction.diagnoses[1].icd10Code).toBe('N18.3');
    expect(result.linkedConditionCount).toBe(1);
  });

  it('leaves an uncatalogued condition uncoded rather than guessing', async () => {
    const extraction = parseStructuredExtraction({
      diagnoses: [{ condition: 'Ehlers-Danlos syndrome' }],
    });
    extractMedicalEntities.mockResolvedValue([]);

    const result = await reconcileExtraction('Diagnosed with Ehlers-Danlos syndrome.', extraction);

    expect(result.extraction.diagnoses[0].icd10Code).toBeUndefined();
    expect(result.linkedConditionCount).toBe(0);
  });
});
