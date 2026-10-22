import { describe, it, expect } from 'vitest';
import { classifyDrug } from './drug-classes';

function generics(name: string): string[] {
  return classifyDrug(name).map((match) => match.generic);
}

describe('classifyDrug', () => {
  it('recognises Pakistani brands by the class the score uses', () => {
    expect(classifyDrug('Tab Daonil 5mg')[0].classes).toEqual(['glibenclamide']);
    expect(classifyDrug('Getryl 2mg')[0].classes).toEqual(['short_acting_su']);
    expect(classifyDrug('Diamicron MR 60')[0].classes).toEqual(['short_acting_su']);
    expect(classifyDrug('Inj Lantus 20 units')[0].classes).toEqual(['basal_insulin']);
    expect(classifyDrug('Neodipar 500')[0].classes).toEqual(['other_glucose_lowering']);
  });

  it('counts both halves of a combination', () => {
    expect(classifyDrug('Glucovance 500/5')[0].classes).toEqual(['glibenclamide', 'other_glucose_lowering']);
  });

  it('prefers the longer name, so a combination is not also its parts', () => {
    expect(generics('Amaryl M 2/500')).toEqual(['glimepiride + metformin']);
    expect(generics('Galvus Met 50/850')).toEqual(['vildagliptin']);
  });

  it('separates premixed from basal and prandial insulin', () => {
    expect(classifyDrug('Mixtard 70/30')[0].classes).toEqual(['mixed_insulin']);
    expect(classifyDrug('NovoMix 30')[0].classes).toEqual(['mixed_insulin']);
    expect(classifyDrug('biphasic insulin aspart')[0].classes).toEqual(['mixed_insulin']);
    expect(classifyDrug('NovoRapid')[0].classes).toEqual(['prandial_insulin']);
  });

  it('matches whole words only', () => {
    // "actos" inside another word must not read as pioglitazone.
    expect(classifyDrug('Lactostat')).toEqual([]);
  });

  it('returns nothing for a drug it does not know', () => {
    expect(classifyDrug('Amlodipine 5mg')).toEqual([]);
    expect(classifyDrug('')).toEqual([]);
  });
});
