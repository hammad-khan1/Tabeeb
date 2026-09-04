import { describe, it, expect } from 'vitest';
import {
  parseMedicalValue,
  parseNumericValue,
  parseReferenceRange,
  isOutOfRange,
  normalizeDigits,
} from './medical-values';

describe('normalizeDigits', () => {
  it('converts Arabic-Indic digits used on Urdu lab reports', () => {
    expect(normalizeDigits('۸.۲')).toBe('8.2');
    expect(normalizeDigits('١٢٣')).toBe('123');
  });

  it('leaves Latin digits and surrounding text alone', () => {
    expect(normalizeDigits('HbA1c 7.4%')).toBe('HbA1c 7.4%');
  });
});

describe('parseMedicalValue', () => {
  it('strips lakh-grouped separators', () => {
    // The original parseFloat stopped at the first comma, turning a platelet count
    // of 150,000 into 1.
    expect(parseMedicalValue('1,50,000')?.value).toBe(150000);
  });

  it('strips western digit grouping', () => {
    expect(parseMedicalValue('1,500,000')?.value).toBe(1500000);
  });

  it('keeps a censoring marker rather than discarding it', () => {
    expect(parseMedicalValue('<5.7')).toEqual({ value: 5.7, censoring: '<' });
    expect(parseMedicalValue('> 200')).toEqual({ value: 200, censoring: '>' });
    expect(parseMedicalValue('≤ 40')).toEqual({ value: 40, censoring: '≤' });
    expect(parseMedicalValue('>=40')).toEqual({ value: 40, censoring: '≥' });
  });

  it('reads a value with a trailing unit', () => {
    expect(parseMedicalValue('7.4 %')?.value).toBe(7.4);
    expect(parseMedicalValue('88.4 umol/L')?.value).toBe(88.4);
  });

  it('handles Arabic-Indic numerals', () => {
    expect(parseMedicalValue('۸.۲')?.value).toBe(8.2);
  });

  it('preserves decimal precision exactly', () => {
    expect(parseMedicalValue('6.8')?.value).toBe(6.8);
  });

  it('reads negative values', () => {
    expect(parseMedicalValue('-2.5')?.value).toBe(-2.5);
  });

  it('returns null for text with no number', () => {
    expect(parseMedicalValue('Negative')).toBeNull();
    expect(parseMedicalValue('')).toBeNull();
    expect(parseMedicalValue(null)).toBeNull();
    expect(parseMedicalValue(undefined)).toBeNull();
  });

  it('passes finite numbers through and rejects non-finite ones', () => {
    expect(parseNumericValue(42)).toBe(42);
    expect(parseNumericValue(Number.NaN)).toBeNull();
    expect(parseNumericValue(Infinity)).toBeNull();
  });
});

describe('parseReferenceRange', () => {
  it('reads a two-sided range in each dash style', () => {
    expect(parseReferenceRange('4.0-5.6')).toEqual({ min: 4, max: 5.6, qualitative: null });
    expect(parseReferenceRange('4.0 – 5.6')).toEqual({ min: 4, max: 5.6, qualitative: null });
    expect(parseReferenceRange('4.0 to 5.6')).toEqual({ min: 4, max: 5.6, qualitative: null });
  });

  it('reads an upper bound only', () => {
    // The form the old two-sided-only regex could not see at all.
    expect(parseReferenceRange('up to 4.2')).toEqual({ min: null, max: 4.2, qualitative: null });
    expect(parseReferenceRange('< 200')).toEqual({ min: null, max: 200, qualitative: null });
    expect(parseReferenceRange('≤ 150')).toEqual({ min: null, max: 150, qualitative: null });
    expect(parseReferenceRange('less than 100')).toEqual({ min: null, max: 100, qualitative: null });
  });

  it('reads a lower bound only', () => {
    expect(parseReferenceRange('> 40')).toEqual({ min: 40, max: null, qualitative: null });
    expect(parseReferenceRange('above 60')).toEqual({ min: 60, max: null, qualitative: null });
  });

  it('recognises qualitative ranges', () => {
    expect(parseReferenceRange('Negative')?.qualitative).toBe('negative');
    expect(parseReferenceRange('Non-reactive')?.qualitative).toBe('non-reactive');
  });

  it('returns null for an unreadable range', () => {
    expect(parseReferenceRange('see comment')).toBeNull();
    expect(parseReferenceRange('')).toBeNull();
    expect(parseReferenceRange(null)).toBeNull();
  });

  it('orders a reversed range', () => {
    expect(parseReferenceRange('5.6-4.0')).toEqual({ min: 4, max: 5.6, qualitative: null });
  });
});

describe('isOutOfRange', () => {
  it('flags a value above a one-sided upper bound', () => {
    // A TSH of 8.2 against "up to 4.2" was previously reported as normal.
    expect(isOutOfRange(8.2, 'up to 4.2')).toBe(true);
    expect(isOutOfRange(3.0, 'up to 4.2')).toBe(false);
  });

  it('flags a value below a one-sided lower bound', () => {
    expect(isOutOfRange(30, '> 40')).toBe(true);
    expect(isOutOfRange(50, '> 40')).toBe(false);
  });

  it('handles two-sided ranges at the boundaries', () => {
    expect(isOutOfRange(4.0, '4.0-5.6')).toBe(false);
    expect(isOutOfRange(5.6, '4.0-5.6')).toBe(false);
    expect(isOutOfRange(3.9, '4.0-5.6')).toBe(true);
    expect(isOutOfRange(5.7, '4.0-5.6')).toBe(true);
  });

  it('returns null rather than false when it cannot tell', () => {
    // The distinction that matters clinically: "unknown" must not read as "normal".
    expect(isOutOfRange(5, 'see comment')).toBeNull();
    expect(isOutOfRange(5, 'Negative')).toBeNull();
    expect(isOutOfRange(5, null)).toBeNull();
    expect(isOutOfRange(null, '4.0-5.6')).toBeNull();
  });
});
