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
    const results = [
      { testName: 'Glucose', value: '95', numericValue: 95, unit: 'mg/dL', referenceRange: null, isAbnormal: false, testDate: '2024-01-01' },
      { testName: 'glucose', value: '100', numericValue: 100, unit: 'mg/dL', referenceRange: null, isAbnormal: false, testDate: '2024-02-01' },
      { testName: 'HbA1c', value: '5.7', numericValue: 5.7, unit: '%', referenceRange: null, isAbnormal: false, testDate: '2024-01-01' },
    ];
    const groups = groupByTest(results);
    expect(groups.size).toBe(2);
    expect(groups.get('glucose')).toHaveLength(2);
    expect(groups.get('hba1c')).toHaveLength(1);
  });

  it('returns empty map for empty input', () => {
    expect(groupByTest([]).size).toBe(0);
  });
});
