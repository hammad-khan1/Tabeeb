import { describe, it, expect } from 'vitest';
import { findAnalyte, canonicalizeLab, normalizeTestName } from './lab-normalizer';

describe('normalizeTestName', () => {
  it('strips punctuation, casing and specimen prefixes', () => {
    expect(normalizeTestName('S. Creatinine')).toBe('creatinine');
    expect(normalizeTestName('HBA1C')).toBe('hba1c');
    expect(normalizeTestName('Vitamin D (25-OH)')).toBe('vitamin d');
  });
});

describe('findAnalyte', () => {
  it('resolves every spelling of one analyte to the same key', () => {
    // These were four separate trend series before.
    const spellings = ['HbA1c', 'HBA1C', 'Hb A1c', 'Glycated Haemoglobin', 'glycosylated hemoglobin'];
    const keys = spellings.map((s) => findAnalyte(s)?.key);
    expect(new Set(keys)).toEqual(new Set(['hba1c']));
  });

  it('distinguishes fasting from random glucose', () => {
    expect(findAnalyte('FBS')?.key).toBe('glucose_fasting');
    expect(findAnalyte('Random Blood Sugar')?.key).toBe('glucose_random');
  });

  it('resolves South Asian lab abbreviations', () => {
    expect(findAnalyte('TLC')?.key).toBe('wbc');
    expect(findAnalyte('SGPT')?.key).toBe('alt');
    expect(findAnalyte('SGOT')?.key).toBe('ast');
  });

  it('returns null for an analyte outside the catalogue', () => {
    // Falling back to the verbatim name is safe; inventing a mapping is not.
    expect(findAnalyte('Serum Widgetase')).toBeNull();
  });

  it('does not match on a fragment of an unrelated word', () => {
    expect(findAnalyte('Potassium Hydroxide Prep')?.key).not.toBe('potassium');
  });
});

describe('canonicalizeLab', () => {
  it('converts µmol/L creatinine into mg/dL', () => {
    const result = canonicalizeLab('Creatinine', 88.4, 'umol/L');
    expect(result.canonicalUnit).toBe('mg/dL');
    expect(result.canonicalValue).toBeCloseTo(1.0, 3);
  });

  it('converts an absolute platelet count into 10^9/L', () => {
    const result = canonicalizeLab('Platelets', 150000, '/cumm');
    expect(result.canonicalValue).toBeCloseTo(150, 3);
    expect(result.canonicalUnit).toBe('10^9/L');
  });

  it('converts mmol/L glucose into mg/dL', () => {
    const result = canonicalizeLab('Fasting Blood Sugar', 5.5, 'mmol/L');
    expect(result.canonicalValue).toBeCloseTo(99.1, 1);
  });

  it('treats a missing unit as already canonical rather than dropping the point', () => {
    const result = canonicalizeLab('HbA1c', 7.2, null);
    expect(result.canonicalValue).toBe(7.2);
  });

  it('passes a value through when the unit already matches', () => {
    expect(canonicalizeLab('Hemoglobin', 13.5, 'g/dL').canonicalValue).toBeCloseTo(13.5, 3);
  });

  it('leaves the value unconverted when the unit is unrecognised', () => {
    // Better to have no canonical value than a wrongly scaled one.
    const result = canonicalizeLab('Creatinine', 5, 'furlongs');
    expect(result.canonicalValue).toBeNull();
    expect(result.canonicalTestName).toBe('creatinine');
  });

  it('keeps the verbatim name for an unknown analyte', () => {
    const result = canonicalizeLab('Serum Widgetase', 4, 'U/L');
    expect(result.canonicalTestName).toBeNull();
    expect(result.displayName).toBe('Serum Widgetase');
  });

  it('carries a LOINC code where the catalogue has one', () => {
    expect(canonicalizeLab('HbA1c', 7, '%').loinc).toBe('4548-4');
  });

  it('handles a unitless analyte', () => {
    const result = canonicalizeLab('INR', 2.4, null);
    expect(result.canonicalValue).toBe(2.4);
    expect(result.canonicalUnit).toBeNull();
  });
});
