import { describe, it, expect } from 'vitest';
import { bandFor, scoreRisk, type ScoreAnswer } from './risk-score';
import type { RiskItem } from './constants';

/**
 * A made-up table with every value filled in, so the arithmetic and band edges are
 * tested independently of the real table's TODO(verify) values. These points are NOT
 * the guideline's.
 */
const FIXTURE: RiskItem[] = [
  {
    id: 'treatment',
    label: 'Treatment',
    options: [
      { id: 'glibenclamide', label: 'Glibenclamide', points: 1 },
      { id: 'other', label: 'Other', points: 0 },
    ],
  },
  {
    id: 'hba1c',
    label: 'HbA1c',
    options: [
      { id: 'high', label: 'High', points: 2.5 },
      { id: 'mid', label: 'Mid', points: 0.5 },
      { id: 'low', label: 'Low', points: 0 },
    ],
  },
  {
    id: 'renal',
    label: 'Renal',
    options: [
      { id: 'severe', label: 'Severe', points: 3.5 },
      { id: 'unverified', label: 'Not yet checked', points: null },
      { id: 'none', label: 'None', points: 0 },
    ],
  },
];

function answer(item: ScoreAnswer['item'], option: string): ScoreAnswer {
  return { item, option, value: option, source: 'answer' };
}

describe('bandFor', () => {
  it('puts the band edges where the guideline does', () => {
    expect(bandFor(0)).toBe('low');
    expect(bandFor(3)).toBe('low');
    expect(bandFor(3.5)).toBe('moderate');
    expect(bandFor(6)).toBe('moderate');
    expect(bandFor(6.5)).toBe('high');
    expect(bandFor(20)).toBe('high');
  });

  it('rejects totals no combination of items can produce', () => {
    expect(() => bandFor(3.25)).toThrow(RangeError);
    expect(() => bandFor(-1)).toThrow(RangeError);
    expect(() => bandFor(Number.NaN)).toThrow(RangeError);
  });
});

describe('scoreRisk', () => {
  it('adds the points and bands the total', () => {
    const result = scoreRisk(
      [answer('treatment', 'glibenclamide'), answer('hba1c', 'high'), answer('renal', 'none')],
      FIXTURE
    );

    expect(result).toMatchObject({ status: 'complete', total: 3.5, band: 'moderate' });
  });

  it('keeps the reason and provenance for every point', () => {
    const provenance = {
      table: 'medications' as const,
      rowId: 'row-1',
      documentId: 'doc-1',
      value: 'Daonil 5mg',
      date: '2026-01-10',
    };
    const result = scoreRisk(
      [
        { item: 'treatment', option: 'glibenclamide', value: 'Daonil 5mg', source: 'record', provenance },
        answer('hba1c', 'low'),
        answer('renal', 'none'),
      ],
      FIXTURE
    );

    expect(result.breakdown[0]).toEqual({
      item: 'treatment',
      option: 'glibenclamide',
      points: 1,
      value: 'Daonil 5mg',
      source: 'record',
      provenance,
    });
  });

  it('gives no band while an item is unanswered', () => {
    const result = scoreRisk([answer('treatment', 'other'), answer('hba1c', 'low')], FIXTURE);

    expect(result.status).toBe('incomplete');
    expect(result).toMatchObject({ missing: ['renal'] });
    expect(result).not.toHaveProperty('band');
  });

  it('gives no band from a value that has not been verified', () => {
    const result = scoreRisk(
      [answer('treatment', 'other'), answer('hba1c', 'low'), answer('renal', 'unverified')],
      FIXTURE
    );

    expect(result).toMatchObject({ status: 'incomplete', missing: [], unverified: ['renal'] });
  });

  it('refuses two answers for one item rather than picking one', () => {
    expect(() =>
      scoreRisk([answer('treatment', 'other'), answer('treatment', 'glibenclamide')], FIXTURE)
    ).toThrow(/More than one answer/);
  });

  it('refuses unknown items and options', () => {
    expect(() => scoreRisk([answer('treatment', 'insulin_maybe')], FIXTURE)).toThrow(/Unknown option/);
    expect(() =>
      scoreRisk(
        [answer('treatment', 'other'), answer('hba1c', 'low'), answer('renal', 'none'), answer('pregnancy', 'x')],
        FIXTURE
      )
    ).toThrow(/Unknown risk item/);
  });

  it('cannot produce a band from the real table until it is verified', () => {
    // Against the real constants: the type item's points are still TODO(verify).
    const result = scoreRisk([answer('diabetes_type', 'type2')]);
    expect(result.status).toBe('incomplete');
  });
});
