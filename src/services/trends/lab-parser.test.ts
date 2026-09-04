import { describe, it, expect } from 'vitest';
import { parseLabResults, groupByTest } from './lab-parser';

describe('parseLabResults', () => {
  it('returns empty array for null input', () => {
    expect(parseLabResults(null)).toEqual([]);
    expect(parseLabResults(undefined)).toEqual([]);
  });

  it('parses lab results from structured data object', () => {
    const data = {
      labResults: [
        { testName: 'Fasting Blood Sugar', value: '126', unit: 'mg/dL', referenceRange: '70-100', testDate: '2024-06-15' },
        { testName: 'HbA1c', value: '6.5', unit: '%', referenceRange: '4.0-5.6', testDate: '2024-06-15' },
      ],
    };
    const results = parseLabResults(data);
    expect(results).toHaveLength(2);
    expect(results[0].testName).toBe('Fasting Blood Sugar');
    expect(results[0].numericValue).toBe(126);
    expect(results[0].isAbnormal).toBe(true);
    expect(results[1].numericValue).toBe(6.5);
  });

  it('parses numeric values from string with comparison operators', () => {
    const data = {
      labResults: [
        { testName: 'WBC', value: '<4.5', unit: 'x10^3/uL', testDate: '2024-01-01' },
        { testName: 'Platelets', value: '>400', unit: 'x10^3/uL', testDate: '2024-01-01' },
      ],
    };
    const results = parseLabResults(data);
    expect(results[0].numericValue).toBe(4.5);
    expect(results[1].numericValue).toBe(400);
  });

  it('handles non-numeric values gracefully', () => {
    const data = {
      labResults: [
        { testName: 'Hepatitis B', value: 'Positive', testDate: '2024-01-01' },
      ],
    };
    const results = parseLabResults(data);
    expect(results[0].numericValue).toBeNull();
    expect(results[0].value).toBe('Positive');
  });

  it('filters out entries without testName', () => {
    const data = {
      labResults: [
        { testName: 'Glucose', value: '95', testDate: '2024-01-01' },
        { value: 'orphan value' },
        null,
      ],
    };
    const results = parseLabResults(data);
    expect(results).toHaveLength(1);
  });

  it('accepts a flat array as input', () => {
    const data = [
      { testName: 'Creatinine', value: '1.2', unit: 'mg/dL', testDate: '2024-03-01' },
    ];
    const results = parseLabResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe('Creatinine');
  });

  it('uses pre-existing numericValue when available', () => {
    const data = {
      labResults: [
        { testName: 'ALT', value: 'forty-five', numericValue: 45, unit: 'U/L', testDate: '2024-01-01' },
      ],
    };
    const results = parseLabResults(data);
    expect(results[0].numericValue).toBe(45);
  });

  it('detects abnormal via reference range when isAbnormal not set', () => {
    const data = {
      labResults: [
        { testName: 'TSH', value: '8.5', unit: 'mIU/L', referenceRange: '0.4-4.0', testDate: '2024-01-01' },
      ],
    };
    const results = parseLabResults(data);
    expect(results[0].isAbnormal).toBe(true);
  });

  it('respects explicit isAbnormal flag over computed', () => {
    const data = {
      labResults: [
        { testName: 'Test', value: '50', referenceRange: '70-100', isAbnormal: false, testDate: '2024-01-01' },
      ],
    };
    const results = parseLabResults(data);
    expect(results[0].isAbnormal).toBe(false);
  });
});

describe('groupByTest', () => {
  it('groups results by lowercase test name', () => {
    const results = parseLabResults({
      labResults: [
        { testName: 'Glucose', value: '95', unit: 'mg/dL', testDate: '2024-01-01' },
        { testName: 'glucose', value: '100', unit: 'mg/dL', testDate: '2024-02-01' },
        { testName: 'HbA1c', value: '5.7', unit: '%', testDate: '2024-01-01' },
      ],
    });
    const groups = groupByTest(results);
    expect(groups.size).toBe(2);
    expect(groups.get('glucose')).toHaveLength(2);
    expect(groups.get('hba1c')).toHaveLength(1);
  });

  it('groups spelling variants of one analyte into a single series', () => {
    const results = parseLabResults({
      labResults: [
        { testName: 'HbA1c', value: '7.1' },
        { testName: 'HBA1C', value: '7.4' },
        { testName: 'Hb A1c', value: '6.9' },
        { testName: 'Glycated Haemoglobin', value: '7.2' },
      ],
    });
    const groups = groupByTest(results);
    expect(groups.size).toBe(1);
    expect(groups.get('hba1c')).toHaveLength(4);
  });

  it('returns empty map for empty input', () => {
    expect(groupByTest([]).size).toBe(0);
  });
});

describe('clinical value parsing', () => {
  it('keeps digit-group separators out of the number', () => {
    // Lakh grouping is standard on Pakistani CBC reports; parseFloat stopped at the
    // first comma and stored a platelet count of 150,000 as 1.
    const [result] = parseLabResults({
      labResults: [{ testName: 'Platelets', value: '1,50,000', unit: '/cumm' }],
    });
    expect(result.numericValue).toBe(150000);
  });

  it('preserves a censoring marker instead of dropping it', () => {
    const [result] = parseLabResults({ labResults: [{ testName: 'HbA1c', value: '<5.7' }] });
    expect(result.numericValue).toBe(5.7);
    expect(result.censoring).toBe('<');
  });

  it('flags a value outside a one-sided reference range', () => {
    const [result] = parseLabResults({
      labResults: [{ testName: 'TSH', value: '8.2', referenceRange: 'up to 4.2' }],
    });
    expect(result.isAbnormal).toBe(true);
    expect(result.abnormalityKnown).toBe(true);
  });

  it('does not claim normality when the range cannot be read', () => {
    const [result] = parseLabResults({
      labResults: [{ testName: 'Culture', value: '3', referenceRange: 'see comment' }],
    });
    expect(result.isAbnormal).toBe(false);
    expect(result.abnormalityKnown).toBe(false);
  });

  it('converts a known analyte into its canonical unit', () => {
    const [result] = parseLabResults({
      labResults: [{ testName: 'Creatinine', value: '88.4', unit: 'umol/L' }],
    });
    expect(result.canonicalUnit).toBe('mg/dL');
    expect(result.canonicalValue).toBeCloseTo(1.0, 2);
  });

  it('leaves an unknown analyte ungrouped rather than guessing', () => {
    const [result] = parseLabResults({
      labResults: [{ testName: 'Serum Widgetase', value: '4' }],
    });
    expect(result.canonicalTestName).toBeNull();
    expect(result.displayName).toBe('Serum Widgetase');
  });
});
