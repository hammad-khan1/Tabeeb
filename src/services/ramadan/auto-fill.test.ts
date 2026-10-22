import { describe, it, expect } from 'vitest';
import {
  deriveRiskInputs,
  longestFast,
  type DiagnosisRow,
  type LabRow,
  type MedicationRow,
  type RecordSnapshot,
  type RiskInputs,
} from './auto-fill';

const NOW = new Date('2027-01-15T00:00:00Z');

function lab(overrides: Partial<LabRow>): LabRow {
  return {
    id: 'lab-1',
    documentId: 'doc-1',
    canonicalTestName: 'hba1c',
    canonicalValue: 9.2,
    canonicalUnit: '%',
    value: '9.2',
    unit: '%',
    testDate: new Date('2026-12-01T00:00:00Z'),
    ...overrides,
  };
}

function med(name: string, id = name): MedicationRow {
  return { id, documentId: 'doc-rx', name, genericName: null, frequency: '1+0+1', prescribedDate: null };
}

function diagnosis(condition: string, overrides: Partial<DiagnosisRow> = {}): DiagnosisRow {
  return {
    id: `dx-${condition}`,
    documentId: 'doc-dx',
    condition,
    canonicalCondition: 'Type 2 diabetes mellitus',
    assertionStatus: 'present',
    diagnosedDate: null,
    ...overrides,
  };
}

function derive(snapshot: Partial<RecordSnapshot>): RiskInputs {
  return deriveRiskInputs({ labs: [], medications: [], diagnoses: [], fasting: null, ...snapshot }, NOW);
}

function filled(inputs: RiskInputs, item: string) {
  return inputs.filled.find((input) => input.item === item);
}

function pending(inputs: RiskInputs, item: string) {
  return inputs.pending.find((input) => input.item === item);
}

describe('deriveRiskInputs', () => {
  it('accounts for every item exactly once, in table order', () => {
    const inputs = derive({});
    const items = [...inputs.filled, ...inputs.pending].map((input) => input.item);
    expect(new Set(items).size).toBe(14);
    expect(inputs.pending[0].item).toBe('diabetes_type');
  });

  it('always asks the items no record holds', () => {
    const inputs = derive({});
    for (const item of ['hypoglycaemia', 'self_monitoring', 'physical_labour', 'previous_ramadan', 'frailty_cognition']) {
      expect(pending(inputs, item)?.reason).toBe('always_asked');
    }
  });

  it('never reads an empty record as a "no"', () => {
    const inputs = derive({});
    expect(inputs.filled).toEqual([]);
    expect(pending(inputs, 'macrovascular')?.reason).toBe('not_in_record');
    expect(pending(inputs, 'renal')?.reason).toBe('not_in_record');
  });

  describe('HbA1c', () => {
    it('fills from a recent result, with provenance', () => {
      const result = filled(derive({ labs: [lab({})] }), 'hba1c');
      expect(result).toMatchObject({ option: 'over_9', value: 'HbA1c 9.2%' });
      expect(result?.provenance).toEqual({
        table: 'lab_results',
        rowId: 'lab-1',
        documentId: 'doc-1',
        value: '9.2 %',
        date: '2026-12-01',
      });
    });

    it('uses the latest of several results', () => {
      const result = filled(
        derive({
          labs: [
            lab({ id: 'old', canonicalValue: 9.5, testDate: new Date('2026-09-01T00:00:00Z') }),
            lab({ id: 'new', canonicalValue: 7.0, testDate: new Date('2026-12-20T00:00:00Z') }),
          ],
        }),
        'hba1c'
      );
      expect(result).toMatchObject({ option: 'under_7_5', provenance: { rowId: 'new' } });
    });

    it('shows an old result as a hint instead of scoring it', () => {
      const result = pending(derive({ labs: [lab({ testDate: new Date('2025-06-01T00:00:00Z') })] }), 'hba1c');
      expect(result).toMatchObject({ reason: 'record_too_old', hints: [{ rowId: 'lab-1' }] });
    });
  });

  describe('treatment', () => {
    it('fills glibenclamide from a brand name', () => {
      const result = filled(derive({ medications: [med('Daonil 5mg'), med('Glucophage 500')] }), 'treatment');
      expect(result).toMatchObject({ option: 'glibenclamide', value: 'Daonil 5mg', provenance: { table: 'medications' } });
    });

    it('fills "other" only when every medicine is known and none is a sulfonylurea or insulin', () => {
      expect(filled(derive({ medications: [med('Neodipar 500')] }), 'treatment')?.option).toBe('other');
    });

    it('turns an unknown medicine into a question, never a zero', () => {
      const result = pending(derive({ medications: [med('Neodipar 500'), med('Diabetex 5mg')] }), 'treatment');
      expect(result).toMatchObject({ reason: 'unrecognised_medicines', suggestedOption: 'other' });
      expect(result?.hints).toHaveLength(2);
    });

    it('asks about premixed and prandial insulin, whose points depend on frequency', () => {
      expect(pending(derive({ medications: [med('Mixtard 70/30')] }), 'treatment')?.reason).toBe('needs_detail');
      expect(pending(derive({ medications: [med('Lantus'), med('NovoRapid')] }), 'treatment')?.reason).toBe('needs_detail');
    });

    it('asks about two scored treatments until the combination rule is verified', () => {
      expect(pending(derive({ medications: [med('Daonil'), med('Lantus')] }), 'treatment')?.reason).toBe(
        'combination_unverified'
      );
    });

    it('does not trust a generic name the extractor filled in', () => {
      const result = pending(
        derive({ medications: [{ ...med('Gluco-X'), genericName: 'glibenclamide' }] }),
        'treatment'
      );
      expect(result?.reason).toBe('unrecognised_medicines');
      expect(result?.suggestedOption).toBeUndefined();
    });
  });

  describe('diabetes type and duration', () => {
    it('reads the type from the document\'s own words', () => {
      expect(filled(derive({ diagnoses: [diagnosis('Type 2 DM')] }), 'diabetes_type')?.option).toBe('type2');
      expect(
        filled(derive({ diagnoses: [diagnosis('T1DM', { canonicalCondition: 'Type 1 diabetes mellitus' })] }), 'diabetes_type')
          ?.option
      ).toBe('type1');
    });

    it('asks when the document only says "diabetes"', () => {
      // The linker files a bare "DM" under type 2; the score must not.
      expect(pending(derive({ diagnoses: [diagnosis('DM')] }), 'diabetes_type')?.reason).toBe('needs_detail');
    });

    it('asks when documents disagree on the type', () => {
      expect(pending(derive({ diagnoses: [diagnosis('Type 2 DM'), diagnosis('Type 1 DM')] }), 'diabetes_type')?.reason).toBe(
        'conflicting'
      );
    });

    it('ignores a diagnosis the document does not attribute to the patient', () => {
      const inputs = derive({ diagnoses: [diagnosis('Type 2 DM', { assertionStatus: 'uncertain' })] });
      expect(filled(inputs, 'diabetes_type')).toBeUndefined();
      expect(pending(inputs, 'diabetes_type')?.hints).toHaveLength(1);
    });

    it('fills ten years or more from the earliest diagnosis, but never fewer', () => {
      const old = diagnosis('Type 2 DM', { diagnosedDate: new Date('2014-03-01T00:00:00Z') });
      expect(filled(derive({ diagnoses: [old] }), 'diabetes_duration')?.option).toBe('ten_or_more');

      // A record from 2022 shows at least five years, not that it is under ten.
      const recent = diagnosis('Type 2 DM', { diagnosedDate: new Date('2022-03-01T00:00:00Z') });
      expect(pending(derive({ diagnoses: [recent] }), 'diabetes_duration')?.reason).toBe('needs_detail');
    });
  });

  describe('renal', () => {
    it('fills from eGFR', () => {
      const egfr = lab({ id: 'egfr', canonicalTestName: 'egfr', canonicalValue: 52, canonicalUnit: 'mL/min/1.73m²' });
      expect(filled(derive({ labs: [egfr] }), 'renal')?.option).toBe('egfr_45_60');
    });

    it('shows creatinine as a hint but does not compute eGFR from it', () => {
      const creatinine = lab({ id: 'cr', canonicalTestName: 'creatinine', canonicalValue: 1.0, canonicalUnit: 'mg/dL' });
      expect(pending(derive({ labs: [creatinine] }), 'renal')).toMatchObject({
        reason: 'needs_detail',
        hints: [{ rowId: 'cr' }],
      });
    });
  });

  it('asks whether heart disease is stable, with the record as a hint', () => {
    const cad = diagnosis('IHD', { canonicalCondition: 'Coronary artery disease' });
    expect(pending(derive({ diagnoses: [cad] }), 'macrovascular')).toMatchObject({
      reason: 'needs_detail',
      hints: [{ value: 'IHD' }],
    });
  });

  it('always asks about pregnancy, even with one in the record', () => {
    const result = pending(derive({ diagnoses: [diagnosis('Pregnancy 20 weeks', { canonicalCondition: null })] }), 'pregnancy');
    expect(result).toMatchObject({ reason: 'always_asked', hints: [{ value: 'Pregnancy 20 weeks' }] });
  });

  it('fills fasting hours from the plan\'s location', () => {
    const fasting = { planId: 'plan-1', city: 'Karachi', longestFastMinutes: 790, longestFastDate: '2027-03-09' };
    expect(filled(derive({ fasting }), 'fasting_hours')).toMatchObject({
      option: 'under_sixteen',
      provenance: { table: 'prayer_times', rowId: 'plan-1' },
    });
  });
});

describe('longestFast', () => {
  it('finds the longest day of the planned month', () => {
    const result = longestFast({
      id: 'plan-1',
      city: 'Karachi',
      latitude: 24.8607,
      longitude: 67.0011,
      ramadanStart: '2027-02-08',
      ramadanEnd: '2027-03-09',
    });
    // Days lengthen through February and March, so the last day is the longest.
    expect(result?.longestFastDate).toBe('2027-03-09');
    expect(result?.longestFastMinutes).toBeGreaterThan(12 * 60);
    expect(result?.longestFastMinutes).toBeLessThan(14 * 60);
  });

  it('needs a location', () => {
    expect(longestFast({ id: 'p', city: null, ramadanStart: '2027-02-08', ramadanEnd: '2027-03-09' })).toBeNull();
  });
});
