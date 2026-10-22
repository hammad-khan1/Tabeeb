import { describe, it, expect } from 'vitest';
import {
  RISK_ITEMS,
  RISK_BANDS,
  SCORE_STEP,
  TREATMENT_COMBINATION_RULE,
  HBA1C_OPTIONS,
  EGFR_OPTIONS,
  BREAK_FAST_BELOW_MG_DL,
  BREAK_FAST_ABOVE_MG_DL,
  MG_DL_PER_MMOL_L,
} from './constants';

function treatmentPoints(id: string): number | null | undefined {
  return RISK_ITEMS.find((item) => item.id === 'treatment')?.options.find((o) => o.id === id)?.points;
}

describe('guideline constants', () => {
  /**
   * Fails on purpose until a clinician copies every point from the IDF-DAR 2021 risk
   * table into constants.ts. The scorer will not produce a band before then.
   */
  it('has every risk score value verified against the IDF-DAR 2021 table', () => {
    const unverified = RISK_ITEMS.flatMap((item) =>
      item.options.filter((option) => option.points === null).map((option) => `${item.id}.${option.id}`)
    );
    if (TREATMENT_COMBINATION_RULE === null) unverified.push('TREATMENT_COMBINATION_RULE');
    if (!HBA1C_OPTIONS.verified) unverified.push('HBA1C_OPTIONS');
    if (!EGFR_OPTIONS.verified) unverified.push('EGFR_OPTIONS');

    expect(unverified, `TODO(verify) values still to fill in:\n${unverified.join('\n')}`).toEqual([]);
  });

  it('keeps the treatment points confirmed from the guideline', () => {
    expect(treatmentPoints('glibenclamide')).toBe(1);
    expect(treatmentPoints('short_acting_su')).toBe(0.5);
    expect(treatmentPoints('basal_insulin')).toBe(1.5);
    expect(treatmentPoints('other')).toBe(0);
  });

  it('scores every filled-in option in steps of 0.5', () => {
    for (const item of RISK_ITEMS) {
      for (const option of item.options) {
        if (option.points === null) continue;
        expect(option.points % SCORE_STEP, `${item.id}.${option.id}`).toBe(0);
        expect(option.points).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('has unique item and option ids', () => {
    const itemIds = RISK_ITEMS.map((item) => item.id);
    expect(new Set(itemIds).size).toBe(itemIds.length);

    for (const item of RISK_ITEMS) {
      const optionIds = item.options.map((option) => option.id);
      expect(new Set(optionIds).size, item.id).toBe(optionIds.length);
    }
  });

  it('uses the 2021 risk bands', () => {
    expect(RISK_BANDS.lowMax).toBe(3);
    expect(RISK_BANDS.moderateMax).toBe(6);
  });

  it('uses the break-the-fast thresholds', () => {
    expect(BREAK_FAST_BELOW_MG_DL).toBe(70);
    expect(BREAK_FAST_ABOVE_MG_DL).toBe(300);
    expect(MG_DL_PER_MMOL_L).toBe(18.016);
  });
});
